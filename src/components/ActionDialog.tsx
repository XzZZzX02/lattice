import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { X } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelAriaLabel?: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelAriaLabel,
  danger = false,
  disabled = false,
  onConfirm,
  onOpenChange
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content confirmation-dialog">
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description asChild>
            <div className="dialog-description">{description}</div>
          </Dialog.Description>
          <Dialog.Close className="dialog-close" aria-label="Close dialog">
            <X size={17} />
          </Dialog.Close>
          <div className="dialog-actions">
            <Dialog.Close asChild>
              <button
                type="button"
                className="button-secondary"
                aria-label={cancelAriaLabel}
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              className={danger ? "button-danger" : "button-primary"}
              disabled={disabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface TextInputDialogProps {
  open: boolean;
  title: string;
  label: string;
  initialValue: string;
  submitLabel: string;
  returnFocus?: () => void;
  onSubmit: (value: string) => void;
  onOpenChange: (open: boolean) => void;
}

export function TextInputDialog({
  open,
  ...props
}: TextInputDialogProps) {
  if (!open) return null;
  return <TextInputDialogContent open {...props} />;
}

function TextInputDialogContent({
  open,
  title,
  label,
  initialValue,
  submitLabel,
  returnFocus,
  onSubmit,
  onOpenChange
}: TextInputDialogProps) {
  const [value, setValue] = useState(initialValue);

  function changeOpen(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen && returnFocus) queueMicrotask(returnFocus);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = value.trim();
    if (!normalized) return;
    onSubmit(normalized);
    changeOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={changeOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="dialog-content input-dialog"
          aria-label={title}
        >
          <Dialog.Title>{title}</Dialog.Title>
          <Dialog.Description>
            Update the label without changing the card content or context.
          </Dialog.Description>
          <Dialog.Close className="dialog-close" aria-label="Close dialog">
            <X size={17} />
          </Dialog.Close>
          <form onSubmit={submit}>
            <label>
              <span>{label}</span>
              <input
                autoFocus
                aria-label={label}
                maxLength={200}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" className="button-secondary">Cancel</button>
              </Dialog.Close>
              <button
                type="submit"
                className="button-primary"
                disabled={!value.trim()}
              >
                {submitLabel}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
