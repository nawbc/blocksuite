import './outline-notice.js';

import type {
  EdgelessPageBlockComponent,
  NoteBlockModel,
} from '@blocksuite/blocks';
import { BlocksUtils, Bound, NoteDisplayMode } from '@blocksuite/blocks';
import { assertExists, DisposableGroup, noop } from '@blocksuite/global/utils';
import type { EditorHost } from '@blocksuite/lit';
import { WithDisposable } from '@blocksuite/lit';
import { type BlockModel, type Page } from '@blocksuite/store';
import { css, html, LitElement, nothing, type PropertyValues } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import {
  type ClickBlockEvent,
  type DisplayModeChangeEvent,
  type FitViewEvent,
  OutlineNoteCard,
  type SelectEvent,
} from '../card/outline-card.js';
import { headingKeys } from '../config.js';
import { startDragging } from '../utils/drag.js';

type OutlineNoteItem = {
  note: NoteBlockModel;

  /**
   * the index of the note inside its parent's children property
   */
  index: number;

  /**
   * the number displayed on the outline panel
   */
  number: number;
};

noop(OutlineNoteCard);

const styles = css`
  .outline-panel-body-container {
    position: relative;
    display: flex;
    align-items: start;
    box-sizing: border-box;
    flex-direction: column;
    width: 100%;
    height: 100%;
    padding: 0 8px;
  }

  .panel-list {
    position: relative;
    width: 100%;
  }

  .panel-list .hidden-title {
    width: 100%;
    font-size: 14px;
    line-height: 24px;
    font-weight: 500;
    color: var(--affine-text-secondary-color);
    padding-left: 8px;
    height: 40px;
    box-sizing: border-box;
    padding: 6px 8px;
    margin-top: 8px;
  }

  .insert-indicator {
    height: 2px;
    border-radius: 1px;
    background-color: var(--affine-brand-color);
    border-radius: 1px;
    position: absolute;
    contain: layout size;
    width: 100%;
  }

  .no-note-container {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .note-placeholder {
    margin-top: 240px;
    align-self: center;
    width: 190px;
    height: 48px;
    color: var(--affine-text-secondary-color, #8e8d91);
    text-align: center;
    /* light/base */
    font-size: 15px;
    font-style: normal;
    font-weight: 400;
    line-height: 24px;
  }
`;

export class OutlinePanelBody extends WithDisposable(LitElement) {
  static override styles = styles;

  @state()
  private _dragging = false;

  @state()
  private _pageVisibleNotes: OutlineNoteItem[] = [];

  @state()
  private _edgelessOnlyNotes: OutlineNoteItem[] = [];

  @property({ attribute: false })
  page!: Page;

  @property({ attribute: false })
  edgeless!: EdgelessPageBlockComponent | null;

  @property({ attribute: false })
  editorHost!: EditorHost;

  @property({ attribute: false })
  mode: 'page' | 'edgeless' = 'page';

  @property({ attribute: false })
  insertIndex?: number;

  @property({ attribute: false })
  showPreviewIcon!: boolean;

  @property({ attribute: false })
  enableNotesSorting!: boolean;

  @property({ attribute: false })
  noticeVisible!: boolean;

  @property({ attribute: false })
  toggleNotesSorting!: () => void;

  @property({ attribute: false })
  setNoticeVisibility!: (visibility: boolean) => void;

  /**
   * store the id of selected notes
   */
  @state()
  private _selected: string[] = [];

  @query('.panel-list')
  panelListElement!: HTMLElement;

  @query('.outline-panel-body-container')
  OutlinePanelContainer!: HTMLElement;

  @property({ attribute: false })
  fitPadding!: number[];

  @property({ attribute: false })
  domHost!: Document | HTMLElement;

  private _pageDisposables: DisposableGroup | null = null;
  private _indicatorTranslateY = 0;
  private _changedFlag = false;
  private _oldViewport?: {
    zoom: number;
    center: {
      x: number;
      y: number;
    };
  };
  private _highlightMask: HTMLDivElement | null = null;
  private _highlightTimeoutId: ReturnType<typeof setTimeout> | null = null;

  get viewportPadding(): [number, number, number, number] {
    return this.fitPadding
      ? ([0, 0, 0, 0].map((val, idx) =>
          Number.isFinite(this.fitPadding[idx]) ? this.fitPadding[idx] : val
        ) as [number, number, number, number])
      : [0, 0, 0, 0];
  }

  private _isEdgelessMode() {
    return this.mode === 'edgeless';
  }

  private _clearHighlightMask() {
    this._highlightMask?.remove();
    this._highlightMask = null;
    if (this._highlightTimeoutId) {
      clearTimeout(this._highlightTimeoutId);
      this._highlightTimeoutId = null;
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();

    if (!this._changedFlag && this._oldViewport) {
      const edgeless = this.edgeless;

      if (!edgeless) return;

      edgeless.service.viewport.setViewport(
        this._oldViewport.zoom,
        [this._oldViewport.center.x, this._oldViewport.center.y],
        true
      );
    }

    this._clearPageDisposables();
    this._clearHighlightMask();
  }

  private _clearPageDisposables() {
    this._pageDisposables?.dispose();
    this._pageDisposables = null;
  }

  private _updateNoticeVisibility() {
    if (this.enableNotesSorting) {
      if (this.noticeVisible) {
        this.setNoticeVisibility(false);
      }
      return;
    }

    const shouldShowNotice = this._pageVisibleNotes.some(
      note => note.note.displayMode === NoteDisplayMode.DocOnly
    );

    if (shouldShowNotice && !this.noticeVisible) {
      this.setNoticeVisibility(true);
    }
  }

  private _setPageDisposables() {
    const { slots, root } = this.page;
    const slotsForUpdate = root
      ? [root.childrenUpdated, slots.blockUpdated]
      : [slots.blockUpdated];

    slots.rootAdded.on(root => {
      this._clearPageDisposables();
      this._pageDisposables = new DisposableGroup();
      this._pageDisposables.add(
        root.childrenUpdated.on(() => {
          this._updateNotes();
          this._updateNoticeVisibility();
        })
      );
    });

    slotsForUpdate.forEach(slot => {
      this._clearPageDisposables();
      this._pageDisposables = new DisposableGroup();
      this._pageDisposables.add(
        slot.on(() => {
          this._updateNotes();
          this._updateNoticeVisibility();
        })
      );
    });

    this._updateNotes();
    this._updateNoticeVisibility();
  }

  override updated(_changedProperties: PropertyValues) {
    if (_changedProperties.has('page') || _changedProperties.has('edgeless')) {
      this._setPageDisposables();
    }

    if (
      _changedProperties.has('mode') &&
      this.edgeless &&
      this._isEdgelessMode()
    ) {
      this._clearHighlightMask();
      if (_changedProperties.get('mode') === undefined) return;

      requestAnimationFrame(() => this._zoomToFit());
    }
  }

  private _updateNotes() {
    const root = this.page.root;

    if (this._dragging) return;

    if (!root) {
      this._pageVisibleNotes = [];
      return;
    }

    const pageVisibleNotes: OutlineNoteItem[] = [];
    const edgelessOnlyNotes: OutlineNoteItem[] = [];
    const oldSelectedSet = this._selected.reduce((pre, id) => {
      pre.add(id);
      return pre;
    }, new Set<string>());
    const newSelected: string[] = [];

    root.children.forEach((block, index) => {
      if (!['affine:note'].includes(block.flavour)) return;

      const blockModel = block as NoteBlockModel;
      const OutlineNoteItem = {
        note: block as NoteBlockModel,
        index,
        number: index + 1,
      };

      if (
        blockModel.displayMode === NoteDisplayMode.EdgelessOnly ||
        (!blockModel.displayMode && blockModel.hidden)
      ) {
        edgelessOnlyNotes.push(OutlineNoteItem);
      } else {
        pageVisibleNotes.push(OutlineNoteItem);
        if (oldSelectedSet.has(block.id)) {
          newSelected.push(block.id);
        }
      }
    });

    this._pageVisibleNotes = pageVisibleNotes;
    this._edgelessOnlyNotes = edgelessOnlyNotes;
    this._selected = newSelected;
  }

  private _moveNotes(
    index: number,
    selected: string[],
    notesMap: Map<string, OutlineNoteItem>,
    notes: OutlineNoteItem[],
    children: NoteBlockModel[]
  ) {
    if (!this._isEdgelessMode() || !children.length || !this.page.root) return;

    const blocks = selected.map(
      id => (notesMap.get(id) as OutlineNoteItem).note
    );
    const draggingBlocks = new Set(blocks);
    const targetIndex =
      index === notes.length ? notes[index - 1].index + 1 : notes[index].index;

    const leftPart = children
      .slice(0, targetIndex)
      .filter(block => !draggingBlocks.has(block));
    const rightPart = children
      .slice(targetIndex)
      .filter(block => !draggingBlocks.has(block));
    const newChildren = [...leftPart, ...blocks, ...rightPart];

    this._changedFlag = true;
    this.page.updateBlock(this.page.root, {
      children: newChildren,
    });
    this.page.root.childrenUpdated.emit();
  }

  private _selectNote(e: SelectEvent) {
    if (!this._isEdgelessMode()) return;

    const { selected, id, multiselect } = e.detail;

    if (!selected) {
      this._selected = this._selected.filter(noteId => noteId !== id);
    } else if (multiselect) {
      this._selected = [...this._selected, id];
    } else {
      this._selected = [id];
    }

    // When edgeless mode, should select notes which display in both mode
    const selectedIds = this._pageVisibleNotes.reduce((ids, item) => {
      const note = item.note;
      if (
        this._selected.includes(note.id) &&
        (!note.displayMode ||
          note.displayMode === NoteDisplayMode.DocAndEdgeless)
      ) {
        ids.push(note.id);
      }
      return ids;
    }, [] as string[]);
    this.edgeless?.service.selection.set({
      elements: selectedIds,
      editing: false,
    });
  }

  private _drag() {
    if (
      !this._selected.length ||
      !this._pageVisibleNotes.length ||
      !this.page.root
    )
      return;

    this._dragging = true;

    // cache the notes in case it is changed by other peers
    const children = this.page.root.children.slice() as NoteBlockModel[];
    const notes = this._pageVisibleNotes;
    const notesMap = this._pageVisibleNotes.reduce((map, note, index) => {
      map.set(note.note.id, {
        ...note,
        number: index + 1,
      });
      return map;
    }, new Map<string, OutlineNoteItem>());
    const selected = this._selected.slice();

    startDragging({
      container: this,
      doc: this.ownerDocument,
      host: this.domHost ?? this.ownerDocument,
      page: this.page,
      outlineListContainer: this.panelListElement,
      onDragEnd: insertIdx => {
        this._dragging = false;
        this.insertIndex = undefined;

        if (insertIdx === undefined) return;

        this._moveNotes(insertIdx, selected, notesMap, notes, children);
      },
      onDragMove: (idx, indicatorTranslateY) => {
        this.insertIndex = idx;
        this._indicatorTranslateY = indicatorTranslateY ?? 0;
      },
    });
  }

  /*
   * Click at blank area to clear selection
   */
  private _clickHandler(e: MouseEvent) {
    e.stopPropagation();
    // check if click at outline-card, if so, do nothing
    if (
      (e.target as HTMLElement).closest('outline-note-card') ||
      this._selected.length === 0
    ) {
      return;
    }

    this._selected = [];
    this.edgeless?.service.selection.set({
      elements: this._selected,
      editing: false,
    });
  }

  /*
   * Double click at blank area to disable notes sorting option
   */
  private _doubleClickHandler(e: MouseEvent) {
    e.stopPropagation();
    // check if click at outline-card, if so, do nothing
    if (
      (e.target as HTMLElement).closest('outline-note-card') ||
      !this.enableNotesSorting
    ) {
      return;
    }

    this.toggleNotesSorting();
  }

  override firstUpdated(): void {
    this.disposables.addFromEvent(this, 'click', this._clickHandler);
    this.disposables.addFromEvent(this, 'dblclick', this._doubleClickHandler);
  }

  private _zoomToFit() {
    const edgeless = this.edgeless;

    if (!edgeless) return;

    const bound = edgeless.getElementsBound();

    if (!bound) return;

    this._oldViewport = {
      zoom: edgeless.service.viewport.zoom,
      center: {
        x: edgeless.service.viewport.center.x,
        y: edgeless.service.viewport.center.y,
      },
    };
    edgeless.service.viewport.setViewportByBound(
      new Bound(bound.x, bound.y, bound.w, bound.h),
      this.viewportPadding,
      true
    );
  }

  private _fitToElement(e: FitViewEvent) {
    const edgeless = this.edgeless;

    if (!edgeless) return;

    const { block } = e.detail;
    const bound = Bound.deserialize(block.xywh);

    edgeless.service.viewport.setViewportByBound(
      bound,
      this.viewportPadding,
      true
    );
  }

  private _deSelectNoteInEdgelessMode(note: NoteBlockModel) {
    if (!this._isEdgelessMode() || !this.edgeless) return;

    const { selection } = this.edgeless.service;
    if (!selection.has(note.id)) return;
    const selectedIds = selection.selectedIds.filter(id => id !== note.id);
    selection.set({
      elements: selectedIds,
      editing: false,
    });
  }

  // when display mode change to page only, we should de-select the note if it is selected in edgeless mode
  private _handleDisplayModeChange(e: DisplayModeChangeEvent) {
    const { note, newMode } = e.detail;
    const { displayMode: currentMode } = note;
    if (newMode === currentMode) {
      return;
    }

    this.page.updateBlock(note, { displayMode: newMode });

    const noteParent = this.page.getParent(note);
    assertExists(noteParent);
    const noteParentChildNotes = noteParent.children.filter(block =>
      BlocksUtils.matchFlavours(block, ['affine:note'])
    ) as NoteBlockModel[];
    const noteParentLastNote =
      noteParentChildNotes[noteParentChildNotes.length - 1];

    // When the display mode of a note change from edgeless to page visible
    // We should move the note to the end of the note list
    if (
      currentMode === NoteDisplayMode.EdgelessOnly &&
      note !== noteParentLastNote
    ) {
      this.page.moveBlocks([note], noteParent, noteParentLastNote, false);
    }

    // When the display mode of a note changed to page only
    // We should check if the note is selected in edgeless mode
    // If so, we should de-select it
    if (newMode === NoteDisplayMode.DocOnly) {
      this._deSelectNoteInEdgelessMode(note);
    }
  }

  private _scrollToBlock(e: ClickBlockEvent) {
    if (this._isEdgelessMode() || !this.editorHost) return;

    const pageBlock = this.editorHost.querySelector('affine-doc-page');
    if (!pageBlock) return;

    const { blockPath } = e.detail;
    const path = [pageBlock.model.id, ...blockPath];
    const blockElement = this.editorHost.view.viewFromPath('block', path);
    if (!blockElement) return;

    blockElement.scrollIntoView({
      behavior: 'instant',
      block: 'center',
      inline: 'center',
    });

    requestAnimationFrame(() => {
      const blockRect = blockElement.getBoundingClientRect();
      const { top, left, width, height } = blockRect;
      const {
        top: offsetY,
        left: offsetX,
        scrollTop,
        scrollLeft,
      } = pageBlock.viewport;

      if (!this._highlightMask) {
        this._highlightMask = document.createElement('div');
        pageBlock.appendChild(this._highlightMask);
      }

      Object.assign(this._highlightMask.style, {
        position: 'absolute',
        top: `${top - offsetY + scrollTop}px`,
        left: `${left - offsetX + scrollLeft}px`,
        width: `${width}px`,
        height: `${height}px`,
        background: 'var(--affine-hover-color)',
        borderRadius: '4px',
        display: 'block',
      });

      // Clear the previous timeout if it exists
      if (this._highlightTimeoutId !== null) {
        clearTimeout(this._highlightTimeoutId);
      }

      this._highlightTimeoutId = setTimeout(() => {
        if (this._highlightMask) {
          this._highlightMask.style.display = 'none';
        }
      }, 1000);
    });
  }

  private _isHeadingBlock(block: BlockModel) {
    return (
      BlocksUtils.matchFlavours(block, ['affine:paragraph']) &&
      headingKeys.has(block.type)
    );
  }

  /**
   * There are two cases that we should render note list:
   * 1. There are headings in the notes
   * 2. No headings, but there are blocks in the notes and note sorting option is enabled
   */
  private _shouldRenderNoteList(noteItems: OutlineNoteItem[]) {
    if (!noteItems.length) return false;

    let hasHeadings = false;
    let hasChildrenBlocks = false;

    for (const noteItem of noteItems) {
      for (const block of noteItem.note.children) {
        hasChildrenBlocks = true;

        if (this._isHeadingBlock(block)) {
          hasHeadings = true;
          break;
        }
      }

      if (hasHeadings) {
        break;
      }
    }

    return hasHeadings || (this.enableNotesSorting && hasChildrenBlocks);
  }

  private _PanelList(withEdgelessOnlyNotes: boolean) {
    const selectedNotesSet = new Set(this._selected);

    return html`<div class="panel-list">
      ${this.insertIndex !== undefined
        ? html`<div
            class="insert-indicator"
            style=${`transform: translateY(${this._indicatorTranslateY}px)`}
          ></div>`
        : nothing}
      ${this._pageVisibleNotes.length
        ? repeat(
            this._pageVisibleNotes,
            note => note.note.id,
            (note, idx) => html`
              <outline-note-card
                data-note-id=${note.note.id}
                .note=${note.note}
                .number=${idx + 1}
                .index=${note.index}
                .page=${this.page}
                .editorMode=${this.mode}
                .status=${selectedNotesSet.has(note.note.id)
                  ? this._dragging
                    ? 'placeholder'
                    : 'selected'
                  : undefined}
                .showPreviewIcon=${this.showPreviewIcon}
                .enableNotesSorting=${this.enableNotesSorting}
                @select=${this._selectNote}
                @drag=${this._drag}
                @fitview=${this._fitToElement}
                @clickblock=${this._scrollToBlock}
                @displaymodechange=${this._handleDisplayModeChange}
              ></outline-note-card>
            `
          )
        : html`${nothing}`}
      ${withEdgelessOnlyNotes
        ? html`<div class="hidden-title">Hidden Contents</div>
            ${repeat(
              this._edgelessOnlyNotes,
              note => note.note.id,
              (note, idx) =>
                html`<outline-note-card
                  data-note-id=${note.note.id}
                  .note=${note.note}
                  .number=${idx + 1}
                  .index=${note.index}
                  .page=${this.page}
                  .invisible=${true}
                  .showPreviewIcon=${this.showPreviewIcon}
                  .enableNotesSorting=${this.enableNotesSorting}
                  @fitview=${this._fitToElement}
                  @displaymodechange=${this._handleDisplayModeChange}
                ></outline-note-card>`
            )} `
        : nothing}
    </div>`;
  }

  private _EmptyPanel() {
    return html`<div class="no-note-container">
      <div class="note-placeholder">
        Use headings to create a table of contents.
      </div>
    </div>`;
  }

  override render() {
    const shouldRenderPageVisibleNotes = this._shouldRenderNoteList(
      this._pageVisibleNotes
    );
    const shouldRenderEdgelessOnlyNotes = this._shouldRenderNoteList(
      this._edgelessOnlyNotes
    );
    const shouldRenderEmptyPanel =
      !shouldRenderPageVisibleNotes && !shouldRenderEdgelessOnlyNotes;

    return html`
      <div class="outline-panel-body-container">
        ${shouldRenderEmptyPanel
          ? this._EmptyPanel()
          : this._PanelList(shouldRenderEdgelessOnlyNotes)}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'outline-panel-body': OutlinePanelBody;
  }
}
