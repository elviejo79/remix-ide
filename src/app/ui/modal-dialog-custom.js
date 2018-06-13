var modal = require('./modaldialog.js')
var yo = require('yo-yo')
var css = require('./styles/modal-dialog-custom-styles')

module.exports = {
  alert: function (text) {
    modal('', yo`<div>${text}</div>`, null, { label: null })
  },
  prompt: function (title, text, inputValue, ok, cancel, focus) {
    prompt(title, text, false, inputValue, ok, cancel, focus)
  },
  promptPassphrase: function (title, text, inputValue, ok, cancel) {
    prompt(title, text, true, inputValue, ok, cancel)
  },
  promptPassphraseCreation: function (ok, cancel) {
    var text = 'Please provide a Passphrase for the account creation'
    var input = yo`<div>
      <input id="prompt1" type="password" name='prompt_text' class="${css['prompt_text']}" placeholder="please enter your password" >
      <br>
      <br>
      <input id="prompt2" type="password" name='prompt_text' class="${css['prompt_text']}" placeholder="please confirm your password" >
    </div>`
    modal(null, yo`<div>${text}<div>${input}</div></div>`,
      {
        fn: () => {
          if (typeof ok === 'function') {
            if (input.querySelector('#prompt1').value === input.querySelector('#prompt2').value) {
              ok(null, input.querySelector('#prompt1').value)
            } else {
              ok('Passphase does not match')
            }
          }
        }
      },
      {
        fn: () => {
          if (typeof cancel === 'function') cancel()
        }
      }
    )
  },
  promptMulti: function ({ title, text, inputValue }, ok, cancel) {
    if (!inputValue) inputValue = ''
    var input = yo`<textarea id="prompt_text" class=${css.prompt_text} rows="4" cols="50"></textarea>`
    modal(title, yo`<div>${text}<div>${input}</div></div>`,
      {
        fn: () => { if (typeof ok === 'function') ok(document.getElementById('prompt_text').value) }
      },
      {
        fn: () => { if (typeof cancel === 'function') cancel() }
      }
    )
  },
  confirm: function (title, text, ok, cancel) {
    modal(title, yo`<div>${text}</div>`,
      {
        fn: () => { if (typeof ok === 'function') ok() }
      },
      {
        fn: () => { if (typeof cancel === 'function') cancel() }
      }
    )
  },
  /**
   * @rv: Unlock account
   * @param {string} adderss address of account
   * @param {(error, password)=>void} cb callback function
   */
  unlockAccount: function(address, cb) {
    const passwordEl = yo`<div>
      <input id="unlock-password-input" type="password" name='prompt_text' class="${css['prompt_text']}" placeholder="please enter your password to unlock your account" >
    </div>`
    modal(`Unlock account: ${address}`, passwordEl, {
      label: 'Unlock',
      fn: ()=> {
        const password = passwordEl.querySelector('#unlock-password-input').value
        return cb(null, password)
      }
    }, {
      label: 'Cancel',
      fn: ()=> {
        return cb('Unlock cancelled', null)
      }
    })
  },
  /**
   * @rv: import account
   * @param {(error, {privateKey:string, password:string, keystore:string})=>void} cb
   */
  importAccount: function(cb) {
    const importPanel = yo`<div>
    <div>
      <span>Select Type</span>
      <select id="import-type-select" value="private-key">
        <option value="private-key" checked>Private Key</option>
        <option value="json-file">JSON File</option>
      </select>
    </div>
    <br>
    <div id="private-key-import">
      <input id="private-key-input" type="text" name='prompt_text' class="${css['prompt_text']}" placeholder="paste your private key here" >
      <br><br>
      <input id="password-input" type="password" name='prompt_text' class="${css['prompt_text']}" placeholder="enter a new password to protect your account" >
    </div>
    <div id="json-file-import">
      <span>Upload JSON file <input type="file" id="json-file-input" style="display:block;" /></span>
      <br>
      <input id="password-input-2" type="password" name='prompt_text' class="${css['prompt_text']}" placeholder="enter password" >
    </div>
  </div>`

    const select = importPanel.querySelector('#import-type-select') 
    function selectImportType() {
      const importType = select.value
      console.log('selectImportType: ', importType)
      if (importType === 'private-key') {
        importPanel.querySelector('#private-key-import').style.display = "block"
        importPanel.querySelector('#json-file-import').style.display = "none"
      } else {
        importPanel.querySelector('#private-key-import').style.display = "none"
        importPanel.querySelector('#json-file-import').style.display = "block"
      }
    }
    select.onchange = selectImportType
    selectImportType()

    const jsonFileInput = importPanel.querySelector('#json-file-input')
    let file = null
    jsonFileInput.onchange = function(event) {
      file = event.target.files[0]
    }

    modal(`Import account`, importPanel, {
      label: 'Import',
      fn: ()=> {
        if (select.value === 'private-key') {
          const privateKey = importPanel.querySelector('#private-key-input').value
          const password = importPanel.querySelector('#password-input').value
          return cb(null, {
            privateKey, 
            password
          })
        } else {
          if (!file) {
            return cb('No JSON file uploaded', {})
          }

          const password = importPanel.querySelector('#password-input-2').value
          const fileReader = new FileReader()
          fileReader.onload = function(event) {
            const keystore = event.target.result
            return cb(null, {
              keystore,
              password
            })
          }
          fileReader.readAsText(file)
        }
      }
    }, {
      label: 'Cancel',
      fn: ()=> {
        return cb('Import cancelled', {})
      }
    })
  }
}

function prompt (title, text, hidden, inputValue, ok, cancel, focus) {
  if (!inputValue) inputValue = ''
  var type = hidden ? 'password' : 'text'
  var input = yo`<input type=${type} name='prompt_text' id='prompt_text' class="${css['prompt_text']}" value='${inputValue}' >`
  modal(title, yo`<div>${text}<div>${input}</div></div>`,
    {
      fn: () => { if (typeof ok === 'function') ok(document.getElementById('prompt_text').value) }
    },
    {
      fn: () => { if (typeof cancel === 'function') cancel() }
    },
    focus ? '#prompt_text' : undefined
  )
}
