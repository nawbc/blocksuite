import '../_common/components/rich-text/rich-text.js';
import './components/code-option.js';
import './components/lang-list.js';

import { assertExists } from '@blocksuite/global/utils';
import {
  INLINE_ROOT_ATTR,
  type InlineRangeProvider,
  type InlineRootElement,
} from '@blocksuite/inline';
import { BlockElement, getInlineRangeProvider } from '@blocksuite/lit';
import {
  autoPlacement,
  limitShift,
  offset,
  shift,
  size,
} from '@floating-ui/dom';
import { css, html, nothing, render, type TemplateResult } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ref } from 'lit/directives/ref.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { type Highlighter, type ILanguageRegistration, type Lang } from 'shiki';
import { z } from 'zod';

import { HoverController } from '../_common/components/index.js';
import { createLitPortal } from '../_common/components/portal.js';
import { bindContainerHotkey } from '../_common/components/rich-text/keymap/index.js';
import type { RichText } from '../_common/components/rich-text/rich-text.js';
import { PAGE_HEADER_HEIGHT } from '../_common/consts.js';
import { ArrowDownIcon } from '../_common/icons/index.js';
import { listenToThemeChange } from '../_common/theme/utils.js';
import { getThemeMode } from '../_common/utils/index.js';
import type { NoteBlockComponent } from '../note-block/note-block.js';
import { EdgelessPageBlockComponent } from '../page-block/edgeless/edgeless-page-block.js';
import { CodeClipboardController } from './clipboard/index.js';
import type { CodeBlockModel, HighlightOptionsGetter } from './code-model.js';
import { CodeOptionTemplate } from './components/code-option.js';
import { LangList } from './components/lang-list.js';
import { getStandardLanguage } from './utils/code-languages.js';
import { getCodeLineRenderer } from './utils/code-line-renderer.js';
import {
  DARK_THEME,
  FALLBACK_LANG,
  LIGHT_THEME,
  PLAIN_TEXT_REGISTRATION,
} from './utils/consts.js';
import { getHighLighter } from './utils/high-lighter.js';

@customElement('affine-code')
export class CodeBlockComponent extends BlockElement<CodeBlockModel> {
  static override styles = css`
    code-block {
      position: relative;
      z-index: 1;
    }

    .affine-code-block-container {
      font-size: var(--affine-font-sm);
      line-height: var(--affine-line-height);
      position: relative;
      padding: 32px 0px 12px 0px;
      background: var(--affine-background-code-block);
      border-radius: 10px;
      margin-top: 24px;
      margin-bottom: 24px;
    }

    .affine-code-block-container .inline-editor {
      font-family: var(--affine-font-code-family);
      font-variant-ligatures: none;
    }

    .affine-code-block-container .lang-list-wrapper {
      position: absolute;
      font-size: var(--affine-font-sm);
      line-height: var(--affine-line-height);
      top: 12px;
      left: 12px;
    }

    .affine-code-block-container > .lang-list-wrapper {
      visibility: hidden;
    }
    .affine-code-block-container:hover > .lang-list-wrapper {
      visibility: visible;
    }

    .affine-code-block-container > .lang-list-wrapper > .lang-button {
      display: flex;
      justify-content: flex-start;
      padding: 0 8px;
    }

    .affine-code-block-container rich-text {
      /* to make sure the resize observer can be triggered as expected */
      display: block;
      position: relative;
      overflow-x: auto;
      overflow-y: hidden;
      padding-bottom: 20px;
      width: 90%;
    }

    .affine-code-block-container .rich-text-container {
      position: relative;
      border-radius: 4px;
      padding: 4px 12px 4px 60px;
    }

    #line-numbers {
      position: absolute;
      text-align: right;
      left: 20px;
      line-height: var(--affine-line-height);
      color: var(--affine-text-secondary-color);
    }

    .affine-code-block-container.wrap #line-numbers {
      top: calc(var(--affine-line-height) + 4px);
    }

    .affine-code-block-container.wrap #line-numbers > div {
      margin-top: calc(var(--top, 0) / 1 - var(--affine-line-height));
    }

    .code-block-option {
      box-shadow: var(--affine-shadow-2);
      border-radius: 8px;
      list-style: none;
      padding: 4px;
      width: 40px;
      background-color: var(--affine-background-overlay-panel-color);
      margin: 0;
    }
  `;

  @state()
  private _wrap = false;

  @query('.lang-button')
  private _langButton!: HTMLButtonElement;

  @state()
  private _langListAbortController?: AbortController;

  clipboardController = new CodeClipboardController(this);

  private get _showLangList() {
    return !!this._langListAbortController;
  }

  get readonly() {
    return this.model.page.readonly;
  }

  override get topContenteditableElement() {
    if (this.rootBlockElement instanceof EdgelessPageBlockComponent) {
      const note = this.closest<NoteBlockComponent>('affine-note');
      return note;
    }
    return this.rootBlockElement;
  }

  highlightOptionsGetter: HighlightOptionsGetter = null;

  readonly attributesSchema = z.object({});
  readonly getAttributeRenderer = () =>
    getCodeLineRenderer(() => ({
      lang: this.model.language.toLowerCase() as Lang,
      highlighter: this._highlighter,
    }));

  private _richTextResizeObserver: ResizeObserver = new ResizeObserver(() => {
    this._updateLineNumbers();
  });

  private _perviousLanguage: ILanguageRegistration = PLAIN_TEXT_REGISTRATION;
  private _highlighter: Highlighter | null = null;
  private async _startHighlight(lang: ILanguageRegistration) {
    if (this._highlighter) {
      const loadedLangs = this._highlighter.getLoadedLanguages();
      if (!loadedLangs.includes(lang.id as Lang)) {
        this._highlighter
          .loadLanguage(lang)
          .then(() => {
            const richText = this.querySelector('rich-text');
            const inlineEditor = richText?.inlineEditor;
            if (inlineEditor) {
              inlineEditor.requestUpdate();
            }
          })
          .catch(console.error);
      }
      return;
    }
    const mode = getThemeMode();
    this._highlighter = await getHighLighter({
      theme: mode === 'dark' ? DARK_THEME : LIGHT_THEME,
      themes: [LIGHT_THEME, DARK_THEME],
      langs: [lang],
      paths: {
        // TODO: use local path
        wasm: 'https://cdn.jsdelivr.net/npm/shiki/dist',
        themes: 'https://cdn.jsdelivr.net/',
        languages: 'https://cdn.jsdelivr.net/npm/shiki/languages',
      },
    });

    const richText = this.querySelector('rich-text');
    assertExists(richText);
    const inlineEditor = richText.inlineEditor;
    assertExists(inlineEditor);
    const range = inlineEditor.getInlineRange();
    inlineEditor.requestUpdate();
    if (range) {
      inlineEditor.setInlineRange(range);
    }
  }

  private _inlineRangeProvider: InlineRangeProvider | null = null;

  get inlineEditor() {
    const inlineRoot = this.querySelector<InlineRootElement>(
      `[${INLINE_ROOT_ATTR}]`
    );
    if (!inlineRoot) {
      throw new Error('Inline editor root not found');
    }
    return inlineRoot.inlineEditor;
  }

  @query('rich-text')
  private _richTextElement?: RichText;

  private _whenHover = new HoverController(this, ({ abortController }) => {
    const selection = this.host.selection;
    const textSelection = selection.find('text');
    if (
      !!textSelection &&
      (!!textSelection.to || !!textSelection.from.length)
    ) {
      return null;
    }

    const blockSelections = selection.filter('block');
    if (
      blockSelections.length > 1 ||
      (blockSelections.length === 1 && blockSelections[0].path !== this.path)
    ) {
      return null;
    }

    return {
      template: ({ updatePortal }) =>
        CodeOptionTemplate({
          anchor: this,
          model: this.model,
          wrap: this._wrap,
          onClickWrap: () => {
            this._wrap = !this._wrap;
            updatePortal();
          },
          abortController,
        }),
      computePosition: {
        referenceElement: this,
        placement: 'right-start',
        middleware: [
          offset({
            mainAxis: 12,
            crossAxis: 10,
          }),
          shift({
            crossAxis: true,
            padding: {
              top: PAGE_HEADER_HEIGHT + 12,
              bottom: 12,
              right: 12,
            },
            limiter: limitShift(),
          }),
        ],
        autoUpdate: true,
      },
    };
  });

  override async getUpdateComplete() {
    const result = await super.getUpdateComplete();
    await this._richTextElement?.updateComplete;
    return result;
  }

  override connectedCallback() {
    super.connectedCallback();
    // set highlight options getter used by "exportToHtml"
    this.clipboardController.hostConnected();
    this.setHighlightOptionsGetter(() => {
      return {
        lang: this._perviousLanguage.id as Lang,
        highlighter: this._highlighter,
      };
    });

    this._disposables.add(() =>
      listenToThemeChange(this, () => {
        if (!this._highlighter) return;
        const richText = this.querySelector('rich-text');
        const inlineEditor = richText?.inlineEditor;
        if (!inlineEditor) return;

        // update code-line theme
        setTimeout(() => {
          inlineEditor.requestUpdate();
        });
      })
    );

    bindContainerHotkey(this);

    const selectionManager = this.host.selection;
    const INDENT_SYMBOL = '  ';
    const LINE_BREAK_SYMBOL = '\n';
    const allIndexOf = (
      text: string,
      symbol: string,
      start = 0,
      end = text.length
    ) => {
      const indexArr: number[] = [];
      let i = start;

      while (i < end) {
        const index = text.indexOf(symbol, i);
        if (index === -1 || index > end) {
          break;
        }
        indexArr.push(index);
        i = index + 1;
      }
      return indexArr;
    };

    this.bindHotKey({
      Backspace: ctx => {
        const state = ctx.get('keyboardState');
        const textSelection = selectionManager.find('text');
        if (!textSelection) {
          state.raw.preventDefault();
          return;
        }

        const from = textSelection.from;

        if (from.index === 0 && from.length === 0) {
          state.raw.preventDefault();
          selectionManager.setGroup('note', [
            selectionManager.create('block', { path: this.path }),
          ]);
          return true;
        }

        return;
      },
      Tab: ctx => {
        const state = ctx.get('keyboardState');
        const event = state.raw;
        const inlineEditor = this.inlineEditor;
        const inlineRange = inlineEditor.getInlineRange();
        if (inlineRange) {
          event.stopPropagation();
          event.preventDefault();

          const text = this.inlineEditor.yText.toString();
          const index = text.lastIndexOf(
            LINE_BREAK_SYMBOL,
            inlineRange.index - 1
          );
          const indexArr = allIndexOf(
            text,
            LINE_BREAK_SYMBOL,
            inlineRange.index,
            inlineRange.index + inlineRange.length
          )
            .map(i => i + 1)
            .reverse();
          if (index !== -1) {
            indexArr.push(index + 1);
          } else {
            indexArr.push(0);
          }
          indexArr.forEach(i => {
            this.inlineEditor.insertText(
              {
                index: i,
                length: 0,
              },
              INDENT_SYMBOL
            );
          });
          this.inlineEditor.setInlineRange({
            index: inlineRange.index + 2,
            length:
              inlineRange.length + (indexArr.length - 1) * INDENT_SYMBOL.length,
          });

          return true;
        }

        return;
      },
      'Shift-Tab': ctx => {
        const state = ctx.get('keyboardState');
        const event = state.raw;
        const inlineEditor = this.inlineEditor;
        const inlineRange = inlineEditor.getInlineRange();
        if (inlineRange) {
          event.stopPropagation();
          event.preventDefault();

          const text = this.inlineEditor.yText.toString();
          const index = text.lastIndexOf(
            LINE_BREAK_SYMBOL,
            inlineRange.index - 1
          );
          let indexArr = allIndexOf(
            text,
            LINE_BREAK_SYMBOL,
            inlineRange.index,
            inlineRange.index + inlineRange.length
          )
            .map(i => i + 1)
            .reverse();
          if (index !== -1) {
            indexArr.push(index + 1);
          } else {
            indexArr.push(0);
          }
          indexArr = indexArr.filter(
            i => text.slice(i, i + 2) === INDENT_SYMBOL
          );
          indexArr.forEach(i => {
            this.inlineEditor.deleteText({
              index: i,
              length: 2,
            });
          });
          if (indexArr.length > 0) {
            this.inlineEditor.setInlineRange({
              index:
                inlineRange.index -
                (indexArr[indexArr.length - 1] < inlineRange.index ? 2 : 0),
              length:
                inlineRange.length -
                (indexArr.length - 1) * INDENT_SYMBOL.length,
            });
          }

          return true;
        }

        return;
      },
    });

    this._inlineRangeProvider = getInlineRangeProvider(this);
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    this.clipboardController.hostDisconnected();
    this._richTextResizeObserver.disconnect();
  }

  override updated() {
    if (this.model.language !== this._perviousLanguage.id) {
      const lang = getStandardLanguage(this.model.language);
      this._perviousLanguage = lang ?? PLAIN_TEXT_REGISTRATION;
      if (lang) {
        this._startHighlight(lang).catch(console.error);
      } else {
        this._highlighter = null;
      }

      const richText = this.querySelector('rich-text');
      const inlineEditor = richText?.inlineEditor;
      if (inlineEditor) {
        inlineEditor.requestUpdate();
      }
    }

    assertExists(this._richTextElement);
    this._richTextResizeObserver.disconnect();
    this._richTextResizeObserver.observe(this._richTextElement);
  }

  setHighlightOptionsGetter(fn: HighlightOptionsGetter) {
    this.highlightOptionsGetter = fn;
  }

  setLang(lang: string | null) {
    const standardLang = lang ? getStandardLanguage(lang) : null;
    const langName = standardLang?.id ?? FALLBACK_LANG;
    this.page.updateBlock(this.model, {
      language: langName,
    });
  }

  private _onClickLangBtn() {
    if (this.readonly) return;
    if (this._langListAbortController) return;
    const abortController = new AbortController();
    this._langListAbortController = abortController;
    abortController.signal.addEventListener('abort', () => {
      this._langListAbortController = undefined;
    });

    const MAX_LANG_SELECT_HEIGHT = 440;
    const portalPadding = {
      top: PAGE_HEADER_HEIGHT + 12,
      bottom: 12,
    } as const;
    createLitPortal({
      closeOnClickAway: true,
      template: ({ positionSlot }) => {
        const langList = new LangList();
        langList.currentLanguageId = this._perviousLanguage.id as Lang;
        langList.onSelectLanguage = (lang: ILanguageRegistration | null) => {
          this.setLang(lang ? lang.id : null);
          abortController.abort();
        };
        langList.onClose = () => abortController.abort();
        positionSlot.on(({ placement }) => {
          langList.placement = placement;
        });
        return html`
          <style>
            :host {
              z-index: var(--affine-z-index-popover);
            }
          </style>
          ${langList}
        `;
      },
      computePosition: {
        referenceElement: this._langButton,
        placement: 'bottom-start',
        middleware: [
          offset(4),
          autoPlacement({
            allowedPlacements: ['top-start', 'bottom-start'],
            padding: portalPadding,
          }),
          size({
            padding: portalPadding,
            apply({ availableHeight, elements, placement }) {
              Object.assign(elements.floating.style, {
                height: '100%',
                maxHeight: `${Math.min(
                  MAX_LANG_SELECT_HEIGHT,
                  availableHeight
                )}px`,
                pointerEvents: 'none',
                ...(placement.startsWith('top')
                  ? {
                      display: 'flex',
                      alignItems: 'flex-end',
                    }
                  : {
                      display: null,
                      alignItems: null,
                    }),
              });
            },
          }),
        ],
        autoUpdate: true,
      },
      abortController,
    });
  }

  private _curLanguageButtonTemplate() {
    const curLanguage =
      getStandardLanguage(this.model.language) ?? PLAIN_TEXT_REGISTRATION;
    const curLanguageDisplayName = curLanguage.displayName ?? curLanguage.id;
    return html`<div
      contenteditable="false"
      class="lang-list-wrapper caret-ignore"
      style="${this._showLangList ? 'visibility: visible;' : ''}"
    >
      <icon-button
        class="lang-button"
        data-testid="lang-button"
        width="auto"
        height="24px"
        ?hover=${this._showLangList}
        ?disabled=${this.readonly}
        @click=${this._onClickLangBtn}
      >
        ${curLanguageDisplayName} ${!this.readonly ? ArrowDownIcon : nothing}
      </icon-button>
    </div>`;
  }

  private _updateLineNumbers() {
    const lineNumbersContainer =
      this.querySelector<HTMLElement>('#line-numbers');
    assertExists(lineNumbersContainer);

    const next = this._wrap ? generateLineNumberRender() : lineNumberRender;

    render(
      repeat(Array.from(this.querySelectorAll('v-line')), next),
      lineNumbersContainer
    );
  }

  override renderBlock(): TemplateResult<1> {
    return html`<div
      ${ref(this._whenHover.setReference)}
      class=${classMap({
        'affine-code-block-container': true,
        wrap: this._wrap,
      })}
    >
      ${this._curLanguageButtonTemplate()}
      <div class="rich-text-container">
        <div contenteditable="false" id="line-numbers"></div>
        <rich-text
          .yText=${this.model.text.yText}
          .inlineEventSource=${this.topContenteditableElement ?? nothing}
          .undoManager=${this.model.page.history}
          .attributesSchema=${this.attributesSchema}
          .attributeRenderer=${this.getAttributeRenderer()}
          .readonly=${this.model.page.readonly}
          .inlineRangeProvider=${this._inlineRangeProvider}
          .enableClipboard=${false}
          .enableUndoRedo=${false}
          .wrapText=${this._wrap}
        >
        </rich-text>
      </div>
      ${this.renderModelChildren(this.model)}
      ${this.selected?.is('block')
        ? html`<affine-block-selection></affine-block-selection>`
        : null}
    </div>`;
  }
}

function generateLineNumberRender(top = 0) {
  return function lineNumberRender(e: HTMLElement, index: number) {
    const style = {
      '--top': `${top}px`,
    };
    top = e.getBoundingClientRect().height;
    return html`<div style=${styleMap(style)}>${index + 1}</div>`;
  };
}

function lineNumberRender(_: HTMLElement, index: number) {
  return html`<div>${index + 1}</div>`;
}

declare global {
  interface HTMLElementTagNameMap {
    'affine-code': CodeBlockComponent;
  }
}
