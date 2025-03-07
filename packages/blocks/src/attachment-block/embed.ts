import { assertExists } from '@blocksuite/global/utils';
import { html, type TemplateResult } from 'lit';

import { withTempBlobData } from '../_common/utils/filesys.js';
import type {
  ImageBlockModel,
  ImageBlockProps,
} from '../image-block/image-model.js';
import { transformModel } from '../page-block/utils/operations/model.js';
import type {
  AttachmentBlockModel,
  AttachmentBlockProps,
} from './attachment-model.js';

const DEFAULT_ATTACHMENT_NAME = 'affine-attachment';

type EmbedConfig = {
  name: string;
  /**
   * Check if the attachment can be turned into embed view.
   */
  check: (model: AttachmentBlockModel) => boolean;
  /**
   * The action will be executed when the 「Turn into embed view」 button is clicked.
   */
  action?: (model: AttachmentBlockModel) => Promise<void> | void;
  /**
   * The template will be used to render the embed view.
   */
  template?: (
    model: AttachmentBlockModel,
    blobUrl: string
  ) => TemplateResult<1>;
};

// 10MB
const MAX_EMBED_SIZE = 10 * 1024 * 1024;

const embedConfig: EmbedConfig[] = [
  {
    name: 'image',
    check: model =>
      model.page.schema.flavourSchemaMap.has('affine:image') &&
      model.type.startsWith('image/'),
    action: model => turnIntoImageBlock(model),
  },
  {
    name: 'pdf',
    check: model =>
      model.type === 'application/pdf' && model.size <= MAX_EMBED_SIZE,
    template: (_, blobUrl) => {
      // More options: https://tinytip.co/tips/html-pdf-params/
      // https://chromium.googlesource.com/chromium/src/+/refs/tags/121.0.6153.1/chrome/browser/resources/pdf/open_pdf_params_parser.ts
      const parameters = '#toolbar=0';
      return html`<iframe
        style="width: 100%; color-scheme: auto;"
        height="480"
        src=${blobUrl + parameters}
        loading="lazy"
        scrolling="no"
        frameborder="no"
        allowTransparency
        allowfullscreen
      ></iframe>`;
    },
  },
  {
    name: 'video',
    check: model =>
      model.type.startsWith('video/') && model.size <= MAX_EMBED_SIZE,
    template: (_, blobUrl) =>
      html`<video width="100%;" height="480" controls src=${blobUrl}></video>`,
  },
  {
    name: 'audio',
    check: model =>
      model.type.startsWith('audio/') && model.size <= MAX_EMBED_SIZE,
    template: (_, blobUrl) =>
      html`<audio controls src=${blobUrl} style="margin: 4px;"></audio>`,
  },
];

export function allowEmbed(model: AttachmentBlockModel) {
  return embedConfig.some(config => config.check(model));
}

export function convertToEmbed(model: AttachmentBlockModel) {
  const config = embedConfig.find(config => config.check(model));
  if (!config || !config.action) {
    model.page.updateBlock<Partial<AttachmentBlockModel>>(model, {
      embed: true,
    });
    return;
  }
  config.action(model)?.catch(console.error);
}

export function renderEmbedView(model: AttachmentBlockModel, blobUrl: string) {
  const config = embedConfig.find(config => config.check(model));
  if (!config || !config.template) {
    console.error('No embed view template found!', model, embedConfig);
    return null;
  }
  return config.template(model, blobUrl);
}

/**
 * Turn the attachment block into an image block.
 */
export async function turnIntoImageBlock(model: AttachmentBlockModel) {
  if (!model.page.schema.flavourSchemaMap.has('affine:image'))
    throw new Error('The image flavour is not supported!');

  const sourceId = model.sourceId;
  assertExists(sourceId);

  const { saveAttachmentData, getImageData } = withTempBlobData();
  saveAttachmentData(sourceId, { name: model.name });

  const imageConvertData = model.sourceId
    ? getImageData(model.sourceId)
    : undefined;

  const imageProp: Partial<ImageBlockProps> = {
    sourceId,
    caption: model.caption,
    size: model.size,
    ...imageConvertData,
  };
  transformModel(model, 'affine:image', imageProp);
}

/**
 * Turn the image block into a attachment block.
 */
export function turnImageIntoCardView(model: ImageBlockModel, blob: Blob) {
  if (!model.page.schema.flavourSchemaMap.has('affine:attachment'))
    throw new Error('The attachment flavour is not supported!');

  if (!model.sourceId) throw new Error('Image data not available');

  const sourceId = model.sourceId;
  assertExists(sourceId);

  const { saveImageData, getAttachmentData } = withTempBlobData();
  saveImageData(sourceId, { width: model.width, height: model.height });
  const attachmentConvertData = getAttachmentData(model.sourceId);
  const attachmentProp: Partial<AttachmentBlockProps> = {
    sourceId,
    name: DEFAULT_ATTACHMENT_NAME,
    size: blob.size,
    type: blob.type,
    caption: model.caption,
    ...attachmentConvertData,
  };
  transformModel(model, 'affine:attachment', attachmentProp);
}
