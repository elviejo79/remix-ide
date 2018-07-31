'use strict'
var ethers = require('ethers')
var helper = require('./txHelper')
var executionContext = require('./execution-context')
var asyncJS = require('async')
var solcLinker = require('solc/linker')
var ethJSUtil = require('ethereumjs-util')
const RLP = require('rlp') // @rv: import RLP for encoding Iele transaction.
const ieleTranslator = require('./ieleTranslator')

// TODO: @rv: this file needs to be modified to support encoding for IELE

module.exports = {

  /**
    * build the transaction data
    *
    * @param {Object} function abi
    * @param {Object} values to encode
    * @param {String} contractBytecode
    */
  encodeData: function (funABI, values, contractBytecode, isIele) { // @rv: add `isIele`
    var encoded
    var encodedHex
    try {
      encoded = helper.encodeParams(funABI, values, isIele)
      encodedHex = encoded.toString('hex')
    } catch (e) {
      return { error: 'cannot encode arguments' }
    }
    if (isIele) {
      if (contractBytecode) {
        return { data: RLP.encode([(contractBytecode.startsWith('0x') ? '' : '0x') + contractBytecode, encoded]).toString('hex') }
      } else {
        return { data: RLP.encode([funABI.name, encoded]).toString('hex') }
      }
    } else {
      if (contractBytecode) {
        return { data: '0x' + contractBytecode + encodedHex.replace('0x', '') }
      } else {
        return { data: helper.encodeFunctionId(funABI) + encodedHex.replace('0x', '') }
      }
    }
  },

  /**
  * encode function / constructor parameters
  *
  * @param {Object} params    - input paramater of the function to call
  * @param {Object} funAbi    - abi definition of the function to call. null if building data for the ctor.
  * @param {Function} callback    - callback
  */
  encodeParams: function (params, funAbi, isIele, callback) {
    // console.log(`@txFormat.js encodeParams: `, params, funAbi)
    var data = ''
    var dataHex = ''
    var funArgs
    if (params.indexOf('raw:0x') === 0) {
      // in that case we consider that the input is already encoded and *does not* contain the method signature
      dataHex = params.replace('raw:0x', '')
      data = Buffer.from(dataHex, 'hex')
    } else {
      try {
        params = params.replace(/(^|,\s+|,)(\d+)(\s+,|,|$)/g, '$1"$2"$3') // replace non quoted number by quoted number
        params = params.replace(/(^|,\s+|,)(0[xX][0-9a-fA-F]+)(\s+,|,|$)/g, '$1"$2"$3') // replace non quoted hex string by quoted hex string
        funArgs = JSON.parse('[' + params + ']')
      } catch (e) {
        callback('Error encoding arguments: ' + e)
        return
      }
      if (funArgs.length > 0) {
        try {
          data = helper.encodeParams(funAbi, funArgs, isIele)
          dataHex = data.toString('hex')
        } catch (e) {
          callback('Error encoding arguments: ' + e)
          return
        }
      }
      if (data.slice(0, 9) === 'undefined') {
        dataHex = data.slice(9)
      }
      if (data.slice(0, 2) === '0x') {
        dataHex = data.slice(2)
      }
    }
    callback(null, { data: data, dataHex: dataHex, funArgs: funArgs })
  },

  /**
  * encode function call (function id + encoded parameters)
  *
  * @param {Object} params    - input paramater of the function to call
  * @param {Object} funAbi    - abi definition of the function to call. null if building data for the ctor.
  * @param {Function} callback    - callback
  */
  encodeFunctionCall: function (params, funAbi, isIele, callback) { // TODO: isIele
    this.encodeParams(params, funAbi, isIele, (error, encodedParam) => {
      if (error) return callback(error)
      if (isIele) { // TODO: fix this 
        callback(null, { dataHex: RLP.encode([funAbi.name, encodedParam]).toString('hex'), funAbi, funArgs: encodedParam.funArgs })
      } else {
        callback(null, { dataHex: helper.encodeFunctionId(funAbi) + encodedParam.dataHex, funAbi, funArgs: encodedParam.funArgs })
      }
    })
  },

  /**
  * encode constructor creation and link with provided libraries if needed
  *
  * @param {Object} contract    - input paramater of the function to call
  * @param {Object} params    - input paramater of the function to call
  * @param {Object} funAbi    - abi definition of the function to call. null if building data for the ctor.
  * @param {Object} linkLibraries    - contains {linkReferences} object which list all the addresses to be linked
  * @param {Object} linkReferences    - given by the compiler, contains the proper linkReferences
  * @param {Function} callback    - callback
  */
  encodeConstructorCallAndLinkLibraries: function (contract, params, funAbi, linkLibraries, linkReferences, callback) {
    const isIele = contract.ielevm
    this.encodeParams(params, funAbi, isIele, (error, encodedParam) => {
      if (error) return callback(error)
      var bytecodeToDeploy = contract.evm.bytecode.object
      if (bytecodeToDeploy.indexOf('_') >= 0) {
        if (linkLibraries && linkReferences) {
          for (var libFile in linkLibraries) {
            for (var lib in linkLibraries[libFile]) {
              var address = linkLibraries[libFile][lib]
              if (!ethJSUtil.isValidAddress(address)) return callback(address + ' is not a valid address. Please check the provided address is valid.')
              bytecodeToDeploy = this.linkLibraryStandardFromlinkReferences(lib, address.replace('0x', ''), bytecodeToDeploy, linkReferences)
            }
          }
        }
      }
      if (bytecodeToDeploy.indexOf('_') >= 0) {
        return callback('Failed to link some libraries')
      }
      return callback(null, { dataHex: bytecodeToDeploy + encodedParam.dataHex, funAbi, funArgs: encodedParam.funArgs, contractBytecode: contract.evm.bytecode.object })
    })
  },

  /**
  * encode constructor creation and deploy librairies if needed
  *
  * @param {String} contractName    - current contract name
  * @param {Object} contract    - input paramater of the function to call
  * @param {Object} contracts    - map of all compiled contracts.
  * @param {Object} params    - input paramater of the function to call
  * @param {Object} funAbi    - abi definition of the function to call. null if building data for the ctor.
  * @param {Function} callback    - callback
  * @param {Function} callbackStep  - callbackStep
  * @param {Function} callbackDeployLibrary  - callbackDeployLibrary
  * @param {Function} callback    - callback
  */
  encodeConstructorCallAndDeployLibraries: function (contractName, contract, contracts, params, funAbi, callback, callbackStep, callbackDeployLibrary) {
    this.encodeParams(params, funAbi, (error, encodedParam) => {
      if (error) return callback(error)
      var dataHex = ''
      var contractBytecode = contract.evm.bytecode.object
      var bytecodeToDeploy = contract.evm.bytecode.object
      if (bytecodeToDeploy.indexOf('_') >= 0) {
        this.linkBytecode(contract, contracts, (err, bytecode) => {
          if (err) {
            callback('Error deploying required libraries: ' + err)
          } else {
            bytecodeToDeploy = bytecode + dataHex
            return callback(null, {dataHex: bytecodeToDeploy, funAbi, funArgs: encodedParam.funArgs, contractBytecode, contractName: contractName})
          }
        }, callbackStep, callbackDeployLibrary)
        return
      } else {
        dataHex = bytecodeToDeploy + encodedParam.dataHex
      }
      callback(null, {dataHex: bytecodeToDeploy, funAbi, funArgs: encodedParam.funArgs, contractBytecode, contractName: contractName})
    })
  },

  /**
  * build the transaction data
  *
  * @param {string} contractName
  * @param {{sourceLanguage: string, vm: string, ielevm?: object, evm?: object, abi: object}} contract    - contract object.
  * @param {object} contracts    - map of all compiled contracts.
  * @param {boolean} isConstructor    - isConstructor.
  * @param {object} funAbi    - abi definition of the function to call. null if building data for the ctor.
  * @param {object} params    - input paramater of the function to call
  * @param {function} callback    - callback
  * @param {function} callbackStep  - callbackStep
  * @param {function} callbackDeployLibrary  - callbackDeployLibrary
  */
  buildData: function (contractName, contract, contracts, isConstructor, funAbi, params, callback, callbackStep, callbackDeployLibrary) {
    // console.log('@txFormat.js buildData => ')
    // console.log('* contractName: ', contractName)
    // console.log('* contract: ', contract)
    // console.log('* contracts: ', contracts)
    // console.log('* isConstructor: ', isConstructor)
    // console.log('* funAbi: ', funAbi)
    // console.log('* params: ', params)
    var funArgs = ''
    var data = ''
    var dataHex = ''

    if (params.indexOf('raw:0x') === 0) {
      // in that case we consider that the input is already encoded and *does not* contain the method signature
      dataHex = params.replace('raw:0x', '')
      data = Buffer.from(dataHex, 'hex')
    } else {
      try {
        params = params.replace(/(^|,\s+|,)(\d+)(\s+,|,|$)/g, '$1"$2"$3') // replace non quoted number by quoted number
        params = params.replace(/(^|,\s+|,)(0[xX][0-9a-fA-F]+)(\s+,|,|$)/g, '$1"$2"$3') // replace non quoted hex string by quoted hex string
        funArgs = JSON.parse('[' + params + ']')
      } catch (e) {
        callback('Error encoding arguments: ' + e)
        return
      }
      if (!isConstructor || funArgs.length > 0 || contract.vm === 'ielevm') {
        if (funArgs.length !== funAbi.inputs.length) { // @rv: Make arguments mandatory
          return callback(`Function ${funAbi.name ? `"${funAbi.name}" `: ""}argument count mismatch. Expected ${funAbi.inputs.length} argument${funAbi.inputs.length > 1 ? 's':''}, but got ${funArgs.length}.`)
        }
        try {
          data = helper.encodeParams(funAbi, funArgs, contract.sourceLanguage, contract.vm) // @rv: Support iele
          dataHex = data.toString('hex')
        } catch (e) {
          callback('Error encoding arguments: ' + e)
          return
        }
      }
      if (data.slice(0, 9) === 'undefined') {
        dataHex = data.slice(9)
      }
      if (data.slice(0, 2) === '0x') {
        dataHex = data.slice(2)
      }
    }
    var contractBytecode
    if (isConstructor) {
      if (contract.vm === 'ielevm') {
        // console.log('@txFormat.js deploy IELE smart contract: ')
        // console.log('* contractByteCode: ', contract.ielevm.bytecode.object)
        // console.log('* data: ', data)
        // console.log('* funArgs: ', funArgs)
        contractBytecode = contract.ielevm.bytecode.object 
        dataHex = RLP.encode([(contractBytecode.startsWith('0x') ? '' : '0x') + contractBytecode, data]).toString('hex') // 0x here is necessary
        // console.log('* dataHex: ', dataHex)
      } else {
        contractBytecode = contract.evm.bytecode.object
        var bytecodeToDeploy = contract.evm.bytecode.object
        if (bytecodeToDeploy.indexOf('_') >= 0) {
          // console.log('* link library: ', bytecodeToDeploy)
          this.linkBytecode(contract, contracts, (err, bytecode) => {
            if (err) {
              callback('Error deploying required libraries: ' + err)
            } else {
              bytecodeToDeploy = bytecode + dataHex
              return callback(null, {dataHex: bytecodeToDeploy, funAbi, funArgs, contractBytecode, contractName, sourceLanguage: contract.sourceLanguage, vm: contract.vm})
            }
          }, callbackStep, callbackDeployLibrary)
          return
        } else {
          dataHex = bytecodeToDeploy + dataHex
        }
      }
    } else {
      if (contract.vm === 'ielevm') {
        // console.log('@txFormat.js call function: ')
        // console.log('* funAbi.name: ', funAbi.name)
        // console.log('* data: ', data)
        // console.log('* funArgs: ', funArgs)
        if (contract.sourceLanguage === 'solidity') {  // convert to iele function name
          // console.log('* solidity2iele funName: ', ieleTranslator.encodeSolidityFunctionName(funAbi))
          dataHex = RLP.encode([ieleTranslator.encodeSolidityFunctionName(funAbi), data]).toString('hex')
        } else {
          dataHex = RLP.encode([funAbi.name, data]).toString('hex')
        }
        // console.log('* dataHex: ', dataHex)
      } else {
        dataHex = helper.encodeFunctionId(funAbi) + dataHex
      }
    }
    callback(null, { dataHex, funAbi, funArgs, contractBytecode, contractName, sourceLanguage: contract.sourceLanguage, vm: contract.vm })
  },

  linkBytecodeStandard: function (contract, contracts, callback, callbackStep, callbackDeployLibrary) {
    asyncJS.eachOfSeries(contract.evm.bytecode.linkReferences, (libs, file, cbFile) => {
      asyncJS.eachOfSeries(contract.evm.bytecode.linkReferences[file], (libRef, libName, cbLibDeployed) => {
        var library = contracts[file][libName]
        if (library) {
          this.deployLibrary(file + ':' + libName, libName, library, contracts, (error, address) => {
            if (error) {
              return cbLibDeployed(error)
            }
            var hexAddress = address.toString('hex')
            if (hexAddress.slice(0, 2) === '0x') {
              hexAddress = hexAddress.slice(2)
            }
            contract.evm.bytecode.object = this.linkLibraryStandard(libName, hexAddress, contract)
            cbLibDeployed()
          }, callbackStep, callbackDeployLibrary)
        } else {
          cbLibDeployed('Cannot find compilation data of library ' + libName)
        }
      }, (error) => {
        cbFile(error)
      })
    }, (error) => {
      if (error) {
        callbackStep(error)
      }
      callback(error, contract.evm.bytecode.object)
    })
  },

  linkBytecodeLegacy: function (contract, contracts, callback, callbackStep, callbackDeployLibrary) {
    var libraryRefMatch = contract.evm.bytecode.object.match(/__([^_]{1,36})__/)
    if (!libraryRefMatch) {
      return callback('Invalid bytecode format.')
    }
    var libraryName = libraryRefMatch[1]
    // file_name:library_name
    var libRef = libraryName.match(/(.*):(.*)/)
    if (!libRef) {
      return callback('Cannot extract library reference ' + libraryName)
    }
    if (!contracts[libRef[1]] || !contracts[libRef[1]][libRef[2]]) {
      return callback('Cannot find library reference ' + libraryName)
    }
    var libraryShortName = libRef[2]
    var library = contracts[libRef[1]][libraryShortName]
    if (!library) {
      return callback('Library ' + libraryName + ' not found.')
    }
    this.deployLibrary(libraryName, libraryShortName, library, contracts, (err, address) => {
      if (err) {
        return callback(err)
      }
      var hexAddress = address.toString('hex')
      if (hexAddress.slice(0, 2) === '0x') {
        hexAddress = hexAddress.slice(2)
      }
      contract.evm.bytecode.object = this.linkLibrary(libraryName, hexAddress, contract.evm.bytecode.object)
      this.linkBytecode(contract, contracts, callback, callbackStep, callbackDeployLibrary)
    }, callbackStep, callbackDeployLibrary)
  },

  linkBytecode: function (contract, contracts, callback, callbackStep, callbackDeployLibrary) {
    if (contract.evm.bytecode.object.indexOf('_') < 0) {
      return callback(null, contract.evm.bytecode.object)
    }
    if (contract.evm.bytecode.linkReferences && Object.keys(contract.evm.bytecode.linkReferences).length) {
      this.linkBytecodeStandard(contract, contracts, callback, callbackStep, callbackDeployLibrary)
    } else {
      this.linkBytecodeLegacy(contract, contracts, callback, callbackStep, callbackDeployLibrary)
    }
  },

  deployLibrary: function (libraryName, libraryShortName, library, contracts, callback, callbackStep, callbackDeployLibrary) {
    var address = library.address
    if (address) {
      return callback(null, address)
    }
    var bytecode = library.evm.bytecode.object
    if (bytecode.indexOf('_') >= 0) {
      this.linkBytecode(library, contracts, (err, bytecode) => {
        if (err) callback(err)
        else this.deployLibrary(libraryName, libraryShortName, library, contracts, callback, callbackStep, callbackDeployLibrary)
      }, callbackStep, callbackDeployLibrary)
    } else {
      callbackStep(`creation of library ${libraryName} pending...`)
      var data = {dataHex: bytecode, funAbi: {type: 'constructor'}, funArgs: [], contractBytecode: bytecode, contractName: libraryShortName}
      callbackDeployLibrary({ data: data, useCall: false }, (err, txResult) => {
        if (err) {
          return callback(err)
        }
        var address = executionContext.isVM() ? txResult.result.createdAddress : txResult.result.contractAddress
        library.address = address
        callback(err, address)
      })
    }
  },

  linkLibraryStandardFromlinkReferences: function (libraryName, address, bytecode, linkReferences) {
    for (var file in linkReferences) {
      for (var libName in linkReferences[file]) {
        if (libraryName === libName) {
          bytecode = this.setLibraryAddress(address, bytecode, linkReferences[file][libName])
        }
      }
    }
    return bytecode
  },

  linkLibraryStandard: function (libraryName, address, contract) {
    return this.linkLibraryStandardFromlinkReferences(libraryName, address, contract.evm.bytecode.object, contract.evm.bytecode.linkReferences)
  },

  setLibraryAddress: function (address, bytecodeToLink, positions) {
    if (positions) {
      for (var pos of positions) {
        var regpos = bytecodeToLink.match(new RegExp(`(.{${2 * pos.start}})(.{${2 * pos.length}})(.*)`))
        if (regpos) {
          bytecodeToLink = regpos[1] + address + regpos[3]
        }
      }
    }
    return bytecodeToLink
  },

  linkLibrary: function (libraryName, address, bytecodeToLink) {
    return solcLinker.linkBytecode(bytecodeToLink, { [libraryName]: ethJSUtil.addHexPrefix(address) })
  },

  // @rv: this is only used for decode response from evm solidity response.
  decodeResponse: function (response, fnabi) {
    // Only decode if there supposed to be fields
    if (fnabi.outputs && fnabi.outputs.length > 0) {
      try {
        var i

        var outputTypes = []
        for (i = 0; i < fnabi.outputs.length; i++) {
          var type = fnabi.outputs[i].type
          outputTypes.push(type === 'tuple' ? helper.makeFullTupleTypeDefinition(fnabi.outputs[i]) : type)
        }

        if (!response.length) response = new Uint8Array(32 * fnabi.outputs.length) // ensuring the data is at least filled by 0 cause `AbiCoder` throws if there's not engouh data
        // decode data
        var abiCoder = new ethers.utils.AbiCoder()
        var decodedObj = abiCoder.decode(outputTypes, response)

        var json = {}
        for (i = 0; i < outputTypes.length; i++) {
          var name = fnabi.outputs[i].name
          json[i] = outputTypes[i] + ': ' + (name ? name + ' ' + decodedObj[i] : decodedObj[i])
        }

        return json
      } catch (e) {
        return { error: 'Failed to decode output: ' + e }
      }
    }
    return {}
  }
}

