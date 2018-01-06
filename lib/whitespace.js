const {CompositeDisposable, Point, Range} = require('atom')

const TRAILING_WHITESPACE_REGEX = /[ \t]+(?=\r?$)/g

const COMMENT_ONLY_LINE_REGEX = /^[\ \t]*[\#\*\/]+[\ \t]*$/

const PACKAGE_JSON = require('../package.json')

module.exports = class Whitespace {
  static getConfigValue (key, ...args) {
    return atom.config.get( `${ PACKAGE_JSON.name }.${ key }`, ...args )
  }
  
  getConfigValue (key, ...args) {
    return this.constructor.getConfigValue( key, ...args )
  }
  
  constructor () {
    this.watchedEditors = new WeakSet()
    this.subscriptions = new CompositeDisposable()

    this.subscriptions.add(atom.workspace.observeTextEditors(editor => {
      return this.handleEvents(editor)
    }))

    this.subscriptions.add(atom.commands.add('atom-workspace', {
      'whitespace:remove-trailing-whitespace': () => {
        let editor = atom.workspace.getActiveTextEditor()

        if (editor) {
          this.removeTrailingWhitespace(editor, editor.getGrammar().scopeName)
        }
      },

      'whitespace:save-with-trailing-whitespace': async () => {
        let editor = atom.workspace.getActiveTextEditor()

        if (editor) {
          this.ignore = true
          await editor.save()
          this.ignore = false
        }
      },

      'whitespace:save-without-trailing-whitespace': () => {
        let editor = atom.workspace.getActiveTextEditor()

        if (editor) {
          this.removeTrailingWhitespace(editor, editor.getGrammar().scopeName)
          editor.save()
        }
      },

      'whitespace:convert-tabs-to-spaces': () => {
        let editor = atom.workspace.getActiveTextEditor()

        if (editor) {
          this.convertTabsToSpaces(editor)
        }
      },

      'whitespace:convert-spaces-to-tabs': () => {
        let editor = atom.workspace.getActiveTextEditor()

        if (editor) {
          return this.convertSpacesToTabs(editor)
        }
      },

      'whitespace:convert-all-tabs-to-spaces': () => {
        let editor = atom.workspace.getActiveTextEditor()

        if (editor) {
          return this.convertTabsToSpaces(editor, true)
        }
      }
    }))
  }

  destroy () {
    return this.subscriptions.dispose()
  }

  handleEvents (editor) {
    if (this.watchedEditors.has(editor)) return

    let buffer = editor.getBuffer()

    let bufferSavedSubscription = buffer.onWillSave(() => {
      return buffer.transact(() => {
        let scopeDescriptor = editor.getRootScopeDescriptor()

        if (this.getConfigValue('removeTrailingWhitespace', {
          scope: scopeDescriptor
        }) && !this.ignore) {
          this.removeTrailingWhitespace(editor, editor.getGrammar().scopeName)
        }

        if (this.getConfigValue('ensureSingleTrailingNewline', {scope: scopeDescriptor})) {
          return this.ensureSingleTrailingNewline(editor)
        }
      })
    })

    let editorTextInsertedSubscription = editor.onDidInsertText((event) => {
      if (event.text !== '\n') {
        return
      }

      if (!buffer.isRowBlank(event.range.start.row)) {
        return
      }

      let scopeDescriptor = editor.getRootScopeDescriptor()

      if (this.getConfigValue('removeTrailingWhitespace', {
        scope: scopeDescriptor
      })) {
        if (!this.getConfigValue('ignoreWhitespaceOnlyLines', {
          scope: scopeDescriptor
        })) {
          return editor.setIndentationForBufferRow(event.range.start.row, 0)
        }
      }
    })

    let editorDestroyedSubscription = editor.onDidDestroy(() => {
      bufferSavedSubscription.dispose()
      editorTextInsertedSubscription.dispose()
      editorDestroyedSubscription.dispose()
      this.subscriptions.remove(bufferSavedSubscription)
      this.subscriptions.remove(editorTextInsertedSubscription)
      this.subscriptions.remove(editorDestroyedSubscription)
      this.watchedEditors.delete(editor)
    })

    this.subscriptions.add(bufferSavedSubscription)
    this.subscriptions.add(editorTextInsertedSubscription)
    this.subscriptions.add(editorDestroyedSubscription)
    this.watchedEditors.add(editor)
  }

  /**
  * Test if the line on a row is whitespace-only *except* for one of more
  * contiguous characters indicating it's part of a comment.
  * 
  * @return {boolean}
  *   `true` if it looks like it is probably just whitespace and a comment
  *   delineator.
  */
  isCommentOnlyLine ({editor, buffer, row}) {
    
    console.log( `CALLING isCommentOnlyLine`, {
      editor: editor.getPath(),
      row: row,
    })
    
    // This... doesn't always seem to work reliably :/
    //
    // if (!editor.isBufferRowCommented( row )) {
    //   console.log( `Row is NOT in a comment, returning false.`, {
    //     line: buffer.lineForRow( row ),
    //     result: editor.isBufferRowCommented( row ),
    //   })
    //   return false;
    // }
    
    const line = buffer.lineForRow( row )
    console.log({ line });
    
    if (COMMENT_ONLY_LINE_REGEX.test( line )) {
      console.log( `line matched, returning true.` )
      return true;
    }
    
    console.log( `no match, returning false.` )
    return false;
  }


  removeTrailingWhitespace (editor, grammarScopeName) {
    console.log( `CALLING removeTrailingWhitespace`, {
      editor: editor.getPath(),
      grammarScopeName
    })
    
    const buffer = editor.getBuffer()
    const scopeDescriptor = editor.getRootScopeDescriptor()
    const cursorRows = new Set(editor.getCursors().map(cursor => cursor.getBufferRow()))

    const ignoreCurrentLine = this.getConfigValue('ignoreWhitespaceOnCurrentLine', {
      scope: scopeDescriptor
    })

    const ignoreWhitespaceOnlyLines = this.getConfigValue('ignoreWhitespaceOnlyLines', {
      scope: scopeDescriptor
    })

    const ignoreCommentOnlyLines = this.getConfigValue('ignoreCommentOnlyLines', {
      scope: scopeDescriptor
    })

    const keepMarkdownLineBreakWhitespace =
      grammarScopeName === 'source.gfm' &&
      this.getConfigValue('keepMarkdownLineBreakWhitespace')

    buffer.transact(() => {
      // TODO - remove this conditional after Atom 1.19 stable is released.
      if (buffer.findAllSync) {
        const ranges = buffer.findAllSync(TRAILING_WHITESPACE_REGEX)
        for (let i = 0, n = ranges.length; i < n; i++) {
          const range = ranges[i]
          const row = range.start.row
          const line = buffer.lineForRow( row );
          const trailingWhitespaceStart = ranges[i].start.column
          if (ignoreCurrentLine && cursorRows.has(row)) continue
          if (ignoreWhitespaceOnlyLines && trailingWhitespaceStart === 0) continue
          
          if (
            ignoreCommentOnlyLines &&
            this.isCommentOnlyLine({ editor, buffer, row })
          ) {
            continue
          }
          
          if (keepMarkdownLineBreakWhitespace) {
            const whitespaceLength = range.end.column - range.start.column
            if (trailingWhitespaceStart > 0 && whitespaceLength >= 2) continue
          }
          buffer.delete(ranges[i])
        }
      } else {
        for (let row = 0, lineCount = buffer.getLineCount(); row < lineCount; row++) {
          const line = buffer.lineForRow(row)
          const lastCharacter = line[line.length - 1]
          if (lastCharacter === ' ' || lastCharacter === '\t') {
            const trailingWhitespaceStart = line.search(TRAILING_WHITESPACE_REGEX)
            if (ignoreCurrentLine && cursorRows.has(row)) continue
            if (ignoreWhitespaceOnlyLines && trailingWhitespaceStart === 0) continue
            
            if (
              ignoreCommentOnlyLines &&
              this.isCommentOnlyLine({ editor, buffer, row })
            ) {
              continue
            }
            
            if (keepMarkdownLineBreakWhitespace) {
              const whitespaceLength = line.length - trailingWhitespaceStart
              if (trailingWhitespaceStart > 0 && whitespaceLength >= 2) continue
            }
            buffer.delete(Range(Point(row, trailingWhitespaceStart), Point(row, line.length)))
          }
        }
      }
    })
  }

  ensureSingleTrailingNewline (editor) {
    let selectedBufferRanges
    let row
    let buffer = editor.getBuffer()
    let lastRow = buffer.getLastRow()

    if (buffer.lineForRow(lastRow) === '') {
      row = lastRow - 1

      while (row && buffer.lineForRow(row) === '') {
        buffer.deleteRow(row--)
      }
    } else {
      selectedBufferRanges = editor.getSelectedBufferRanges()
      buffer.append('\n')
      editor.setSelectedBufferRanges(selectedBufferRanges)
    }
  }

  convertTabsToSpaces (editor, convertAllTabs) {
    let buffer = editor.getBuffer()
    let spacesText = new Array(editor.getTabLength() + 1).join(' ')
    let regex = (convertAllTabs ? /\t/g : /^\t+/g)

    buffer.transact(function () {
      return buffer.scan(regex, function ({replace}) {
        return replace(spacesText)
      })
    })

    return editor.setSoftTabs(true)
  }

  convertSpacesToTabs (editor) {
    let buffer = editor.getBuffer()
    let scope = editor.getRootScopeDescriptor()
    let fileTabSize = editor.getTabLength()

    let userTabSize = atom.config.get('editor.tabLength', {
      scope: scope
    })

    let regex = new RegExp(' '.repeat(fileTabSize), 'g')

    buffer.transact(function () {
      return buffer.scan(/^[ \t]+/g, function ({matchText, replace}) {
        return replace(matchText.replace(regex, '\t').replace(/[ ]+\t/g, '\t'))
      })
    })

    editor.setSoftTabs(false)

    if (fileTabSize !== userTabSize) {
      return editor.setTabLength(userTabSize)
    }
  }
}
