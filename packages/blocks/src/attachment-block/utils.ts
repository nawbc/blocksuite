import { assertExists } from '@blocksuite/global/utils';
import type { EditorHost } from '@blocksuite/lit';
import type { BlockModel } from '@blocksuite/store';

import { toast } from '../_common/components/toast.js';
import { humanFileSize } from '../_common/utils/math.js';
import type { AttachmentBlockComponent } from './attachment-block.js';
import type {
  AttachmentBlockModel,
  AttachmentBlockProps,
} from './attachment-model.js';
import { defaultAttachmentProps } from './attachment-model.js';
import { allowEmbed } from './embed.js';

export function cloneAttachmentProperties(model: AttachmentBlockModel) {
  const clonedProps = {} as AttachmentBlockProps;
  for (const cur in defaultAttachmentProps) {
    const key = cur as keyof AttachmentBlockProps;
    // @ts-expect-error it's safe because we just cloned the props simply
    clonedProps[key] = model[
      key
    ] as AttachmentBlockProps[keyof AttachmentBlockProps];
  }
  return clonedProps;
}

const attachmentUploads = new Set<string>();
export function setAttachmentUploading(blockId: string) {
  attachmentUploads.add(blockId);
}
export function setAttachmentUploaded(blockId: string) {
  attachmentUploads.delete(blockId);
}
function isAttachmentUploading(blockId: string) {
  return attachmentUploads.has(blockId);
}

/**
 * This function will not verify the size of the file.
 */
async function uploadAttachmentBlob(
  editorHost: EditorHost,
  blockId: string,
  blob: Blob
): Promise<void> {
  if (isAttachmentUploading(blockId)) {
    throw new Error('The attachment is already uploading!');
  }

  const page = editorHost.page;
  let sourceId: string | undefined;

  try {
    setAttachmentUploading(blockId);
    sourceId = await page.blob.set(blob);
  } catch (error) {
    console.error(error);
    if (error instanceof Error) {
      toast(
        editorHost,
        `Failed to upload attachment! ${error.message || error.toString()}`
      );
    }
  } finally {
    setAttachmentUploaded(blockId);

    const attachmentModel = page.getBlockById(
      blockId
    ) as AttachmentBlockModel | null;
    assertExists(attachmentModel);

    page.withoutTransact(() => {
      page.updateBlock(attachmentModel, {
        sourceId,
      } satisfies Partial<AttachmentBlockProps>);
    });
  }
}

export async function getAttachmentBlob(model: AttachmentBlockModel) {
  const sourceId = model.sourceId;
  if (!sourceId) {
    return null;
  }

  const blobManager = model.page.blob;
  const blob = await blobManager.get(sourceId);
  return blob;
}

export async function checkAttachmentBlob(block: AttachmentBlockComponent) {
  const model = block.model;
  const { id, sourceId } = model;

  if (isAttachmentUploading(id)) {
    block.loading = true;
    return;
  }

  try {
    if (!sourceId) {
      throw new Error('Attachment sourceId is missing!');
    }

    const blob = await getAttachmentBlob(model);
    if (!blob) {
      throw new Error('Attachment blob is missing!');
    }

    block.loading = false;
    block.error = false;
    block.allowEmbed = allowEmbed(model);
    if (block.blobUrl) {
      URL.revokeObjectURL(block.blobUrl);
    }
    block.blobUrl = URL.createObjectURL(blob);
  } catch (error) {
    console.warn(error, model, sourceId);

    block.loading = false;
    block.error = true;
    block.allowEmbed = false;
    if (block.blobUrl) {
      URL.revokeObjectURL(block.blobUrl);
      block.blobUrl = undefined;
    }
  }
}

/**
 * Since the size of the attachment may be very large,
 * the download process may take a long time!
 */
export async function downloadAttachmentBlob(block: AttachmentBlockComponent) {
  const { host, model, loading, error, downloading, blobUrl } = block;
  if (downloading) {
    toast(host, 'Download in progress...');
    return;
  }

  const name = model.name;
  const shortName = name.length < 20 ? name : name.slice(0, 20) + '...';

  if (loading) {
    toast(host, 'Please wait, file is loading...');
    return;
  }

  if (error || !blobUrl) {
    toast(host, `Failed to download ${shortName}!`);
    return;
  }

  block.downloading = true;

  toast(host, `Downloading ${shortName}`);

  const tmpLink = document.createElement('a');
  const event = new MouseEvent('click');
  tmpLink.download = name;
  tmpLink.href = blobUrl;
  tmpLink.dispatchEvent(event);
  tmpLink.remove();

  block.downloading = false;
}

/**
 * Add a new attachment block before / after the specified block.
 */
export function addSiblingAttachmentBlocks(
  editorHost: EditorHost,
  files: File[],
  maxFileSize: number,
  targetModel: BlockModel,
  place: 'before' | 'after' = 'after'
) {
  if (!files.length) return;

  const isSizeExceeded = files.some(file => file.size > maxFileSize);
  if (isSizeExceeded) {
    toast(
      editorHost,
      `You can only upload files less than ${humanFileSize(
        maxFileSize,
        true,
        0
      )}`
    );
    return;
  }

  const page = targetModel.page;
  const attachmentBlockProps: (Partial<AttachmentBlockProps> & {
    flavour: 'affine:attachment';
  })[] = files.map(file => ({
    flavour: 'affine:attachment',
    name: file.name,
    size: file.size,
    type: file.type,
  }));

  const blockIds = page.addSiblingBlocks(
    targetModel,
    attachmentBlockProps,
    place
  );

  blockIds.map(
    (blockId, index) =>
      void uploadAttachmentBlob(editorHost, blockId, files[index])
  );

  return blockIds;
}
