import '../buttons/tool-icon-button.js';
import '../toolbar/shape/shape-menu.js';

import { WithDisposable } from '@blocksuite/lit';
import { baseTheme } from '@toeverything/theme';
import { css, html, LitElement, type TemplateResult, unsafeCSS } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';

import {
  BringForwardIcon,
  BringToFrontIcon,
  CopyAsPngIcon,
  FrameIcon,
  GroupIcon,
  MoreCopyIcon,
  MoreDeleteIcon,
  MoreDuplicateIcon,
  MoreHorizontalIcon,
  MoreVerticalIcon,
  SendBackwardIcon,
  SendToBackIcon,
} from '../../../../_common/icons/index.js';
import { type ReorderingType } from '../../../../_common/utils/index.js';
import type { EdgelessPageBlockComponent } from '../../edgeless-page-block.js';
import { removeContainedFrames } from '../../frame-manager.js';
import { duplicate, splitElements } from '../../utils/clipboard-utils.js';
import { deleteElements } from '../../utils/crud.js';
import { isFrameBlock } from '../../utils/query.js';
import { createButtonPopper } from '../utils.js';

type Action =
  | {
      icon: TemplateResult<1>;
      name: string;
      type:
        | 'delete'
        | 'copy-as-png'
        | 'create-frame'
        | 'create-group'
        | 'copy'
        | 'duplicate'
        | ReorderingType;
      disabled?: boolean;
    }
  | {
      type: 'divider';
    };

const ACTIONS: Action[] = [
  { icon: FrameIcon, name: 'Frame Section', type: 'create-frame' },
  { icon: GroupIcon, name: 'Group Section', type: 'create-group' },
  { type: 'divider' },
  { icon: BringToFrontIcon, name: 'Bring to Front', type: 'front' },
  { icon: BringForwardIcon, name: 'Bring Forward', type: 'forward' },
  { icon: SendBackwardIcon, name: 'Send Backward', type: 'backward' },
  { icon: SendToBackIcon, name: 'Send to Back', type: 'back' },
  { type: 'divider' },
  { icon: MoreCopyIcon, name: 'Copy', type: 'copy' },
  { icon: CopyAsPngIcon, name: 'Copy as PNG', type: 'copy-as-png' },
  { icon: MoreDuplicateIcon, name: 'Duplicate', type: 'duplicate' },
  { type: 'divider' },
  { icon: MoreDeleteIcon, name: 'Delete', type: 'delete' },
];

const FRAME_ACTIONS: Action[] = [
  { icon: FrameIcon, name: 'Frame Section', type: 'create-frame' },
  { type: 'divider' },
  { icon: MoreCopyIcon, name: 'Copy', type: 'copy' },
  { icon: CopyAsPngIcon, name: 'Copy as PNG', type: 'copy-as-png' },
  { icon: MoreDuplicateIcon, name: 'Duplicate', type: 'duplicate' },
  { type: 'divider' },
  { icon: MoreDeleteIcon, name: 'Delete', type: 'delete' },
];

function Actions(
  actions: Action[],
  onClick: (action: Action) => Promise<void> | void
) {
  return repeat(
    actions,
    action => action.type,
    action => {
      return action.type === 'divider'
        ? html`<menu-divider></menu-divider>`
        : html`<div
            class="action-item ${action.type}"
            @click=${() => onClick(action)}
            ?data-disabled=${action.disabled}
          >
            ${action.icon}${action.name}
          </div>`;
    }
  );
}

@customElement('edgeless-more-button')
export class EdgelessMoreButton extends WithDisposable(LitElement) {
  static override styles = css`
    :host {
      display: block;
      color: var(--affine-text-primary-color);
      fill: currentColor;
      font-family: ${unsafeCSS(baseTheme.fontSansFamily)};
    }

    .more-actions-container {
      display: none;
      position: absolute;
      width: 164px;
      padding: 8px;
      justify-content: center;
      align-items: center;
      background: var(--affine-background-overlay-panel-color);
      box-shadow: var(--affine-shadow-2);
      border-radius: 8px;
      font-size: 16px;
      line-height: 22px;
    }

    .more-actions-container[data-show] {
      display: block;
    }

    .action-item {
      display: flex;
      white-space: nowrap;
      height: 32px;
      box-sizing: border-box;
      font-size: 14px;
      padding: 4px 8px;
      border-radius: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      cursor: pointer;
      align-items: center;
      gap: 8px;
    }

    menu-divider {
      width: 88%;
      position: relative;
      left: 8px;
    }

    .action-item:hover {
      background-color: var(--affine-hover-color);
    }
    .action-item:hover.delete {
      background-color: var(--affine-background-error-color);
      color: var(--affine-error-color);
    }

    .action-item[data-disabled] {
      cursor: not-allowed;
    }
  `;

  @property({ attribute: false })
  elements: string[] = [];

  @property({ attribute: false })
  edgeless!: EdgelessPageBlockComponent;

  @property({ attribute: false })
  vertical = false;

  @state()
  private _showPopper = false;

  @property({ attribute: false })
  setPopperShow!: (popperShow: boolean) => void;

  @query('.more-actions-container')
  private _actionsMenu!: HTMLDivElement;

  private _actionsMenuPopper: ReturnType<typeof createButtonPopper> | null =
    null;

  get page() {
    return this.edgeless.page;
  }

  get selection() {
    return this.edgeless.service.selection;
  }

  get slots() {
    return this.edgeless.slots;
  }

  get surface() {
    return this.edgeless.surface;
  }
  private _delete() {
    this.page.captureSync();
    deleteElements(this.surface, this.selection.elements);

    this.selection.set({
      elements: [],
      editing: false,
    });
  }

  private _runAction = async ({ type }: Action) => {
    const selection = this.edgeless.service.selection;
    switch (type) {
      case 'copy': {
        // FIXME(clipboard): copy
        // this.edgeless.clipboardController.copy();
        break;
      }
      case 'duplicate': {
        await duplicate(this.edgeless, selection.elements);
        break;
      }
      case 'delete': {
        this._delete();
        break;
      }
      case 'copy-as-png': {
        const { notes, frames, shapes, images } = splitElements(
          this.selection.elements
        );
        this.slots.copyAsPng.emit({
          blocks: [...notes, ...removeContainedFrames(frames), ...images],
          shapes,
        });
        break;
      }
      case 'create-frame': {
        this.edgeless.surface.frame.createFrameOnSelected();
        break;
      }
      case 'create-group': {
        this.edgeless.service.createGroupFromSelected();
        break;
      }
      case 'front':
      case 'forward':
      case 'backward':
      case 'back': {
        this.selection.elements.forEach(el => {
          this.edgeless.service.reorderElement(el, type);
        });
        break;
      }
    }
    this._actionsMenuPopper?.hide();
  };

  override firstUpdated(changedProperties: Map<string, unknown>) {
    const _disposables = this._disposables;

    this._actionsMenuPopper = createButtonPopper(
      this,
      this._actionsMenu,
      ({ display }) => {
        this._showPopper = display === 'show';
        this.setPopperShow(this._showPopper);
      }
    );
    _disposables.add(this._actionsMenuPopper);
    super.firstUpdated(changedProperties);
  }

  override render() {
    const selection = this.edgeless.service.selection;

    const actions = Actions(
      selection.elements.some(ele => isFrameBlock(ele))
        ? FRAME_ACTIONS
        : ACTIONS,
      this._runAction
    );
    return html`
      <edgeless-tool-icon-button
        .tooltip=${this._showPopper ? '' : 'More'}
        .active=${false}
        .iconContainerPadding=${2}
        @click=${() => this._actionsMenuPopper?.toggle()}
      >
        ${this.vertical ? MoreVerticalIcon : MoreHorizontalIcon}
      </edgeless-tool-icon-button>
      <div class="more-actions-container">${actions}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'edgeless-more-button': EdgelessMoreButton;
  }
}
