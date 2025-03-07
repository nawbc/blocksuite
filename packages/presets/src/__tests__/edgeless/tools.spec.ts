import type {
  EdgelessPageBlockComponent,
  SurfaceBlockComponent,
} from '@blocksuite/blocks';
import type {} from '@blocksuite/blocks';
import { beforeEach, describe, expect, test } from 'vitest';

import { wait } from '../utils/common.js';
import { click, drag } from '../utils/common.js';
import { addNote, getPageRootBlock, getSurface } from '../utils/edgeless.js';
import { setupEditor } from '../utils/setup.js';

describe('default tool', () => {
  let surface!: SurfaceBlockComponent;
  let edgeless!: EdgelessPageBlockComponent;
  let service!: EdgelessPageBlockComponent['service'];

  beforeEach(async () => {
    const cleanup = await setupEditor('edgeless');

    edgeless = getPageRootBlock(page, editor, 'edgeless');
    surface = getSurface(window.page, window.editor);
    service = edgeless.service;

    edgeless.tools.edgelessTool = {
      type: 'default',
    };

    return cleanup;
  });

  test('element click selection', async () => {
    const id = service.addElement('shape', {
      shapeType: 'rect',
      xywh: '[0,0,100,100]',
      fillColor: 'red',
    });

    await wait();

    service.viewport.setViewport(1, [
      surface.renderer.width / 2,
      surface.renderer.height / 2,
    ]);

    click(edgeless.host, { x: 0, y: 50 });

    expect(edgeless.service.selection.selections[0].elements).toEqual([id]);
  });

  test('element drag moving', async () => {
    const id = edgeless.service.addElement('shape', {
      shapeType: 'rect',
      xywh: '[0,0,100,100]',
      fillColor: 'red',
    });
    await wait();

    edgeless.service.viewport.setViewport(1, [
      surface.renderer.width / 2,
      surface.renderer.height / 2,
    ]);
    await wait();

    click(edgeless.host, { x: 0, y: 50 });
    drag(edgeless.host, { x: 0, y: 50 }, { x: 0, y: 150 });
    await wait();

    const element = service.getElementById(id)!;
    expect(element.xywh).toEqual(`[0,100,100,100]`);
  });

  test('block drag moving', async () => {
    const noteId = addNote(page);

    await wait();

    edgeless.service.viewport.setViewport(1, [
      surface.renderer.width / 2,
      surface.renderer.height / 2,
    ]);
    await wait();

    click(edgeless.host, { x: 50, y: 50 });
    expect(edgeless.service.selection.selections[0].elements).toEqual([noteId]);
    drag(edgeless.host, { x: 50, y: 50 }, { x: 150, y: 150 });
    await wait();

    const element = service.getElementById(noteId)!;
    const [x, y] = JSON.parse(element.xywh);

    expect(x).toEqual(100);
    expect(y).toEqual(100);
  });
});
