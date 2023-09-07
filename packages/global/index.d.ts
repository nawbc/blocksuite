declare type BlockSuiteFlags = {
  enable_set_remote_flag: boolean;
  enable_drag_handle: boolean;
  enable_surface: boolean;
  enable_block_hub: boolean;
  enable_slash_menu: boolean;

  enable_expand_database_block: boolean;

  /**
   * Block selection can trigger format bar
   *
   * @deprecated Currently, this feature is stable enough.
   */
  enable_block_selection_format_bar: boolean;

  enable_toggle_block: boolean;
  enable_edgeless_toolbar: boolean;
  enable_linked_page: boolean;
  enable_bookmark_operation: boolean;
  enable_note_index: boolean;
  enable_attachment_block: boolean;

  readonly: Record<string, boolean>;
};
