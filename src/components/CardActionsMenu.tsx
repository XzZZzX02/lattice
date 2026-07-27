import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, Pencil, Share2, Trash2 } from "lucide-react";
import type { RefObject } from "react";

export function CardActionsMenu({
  canDelete,
  deletionDisabled,
  triggerRef,
  onAddToMap,
  onDelete,
  onRename
}: {
  canDelete: boolean;
  deletionDisabled: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  onAddToMap: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  return (
    <div className="card-header-actions">
      <button className="button-quiet map-action" onClick={onAddToMap}>
        <Share2 size={13} /> Add to map
      </button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            ref={triggerRef}
            aria-label="Card actions"
            className="icon-button"
            type="button"
          >
            <Ellipsis size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="dropdown-content"
            sideOffset={7}
          >
            <DropdownMenu.Item className="dropdown-item" onSelect={onRename}>
              <Pencil size={14} /> Rename card
            </DropdownMenu.Item>
            {canDelete && (
              <>
                <DropdownMenu.Separator className="dropdown-separator" />
                <DropdownMenu.Item
                  className="dropdown-item danger"
                  disabled={deletionDisabled}
                  onSelect={onDelete}
                >
                  <Trash2 size={14} /> Delete card
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
