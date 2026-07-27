import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MessageComposer } from "./MessageComposer";

const modelProfiles = [{
  id: "model-1",
  name: "本地推理模型",
  provider: "ollama" as const,
  baseUrl: "http://localhost:11434",
  model: "preview",
  keychainRef: null,
  createdAt: "",
  updatedAt: ""
}];

function renderComposer(overrides: Partial<React.ComponentProps<
  typeof MessageComposer
>> = {}) {
  const props: React.ComponentProps<typeof MessageComposer> = {
    activeModelProfileId: "model-1",
    activeRequestId: null,
    activeRequestCardId: null,
    message: "Map this idea",
    modelProfiles,
    quotes: [],
    onCancel: vi.fn(),
    onMessageChange: vi.fn(),
    onModelChange: vi.fn(),
    onRemoveQuote: vi.fn(),
    onSubmit: vi.fn((event) => event.preventDefault()),
    ...overrides
  };
  render(<MessageComposer {...props} />);
  return props;
}

describe("MessageComposer", () => {
  it("submits a configured message with the keyboard shortcut", async () => {
    const user = userEvent.setup();
    const props = renderComposer();

    await user.click(screen.getByRole("textbox", { name: "Message" }));
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    expect(props.onSubmit).toHaveBeenCalledOnce();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("model-1");
  });

  it("reports message and model changes", async () => {
    const user = userEvent.setup();
    const props = renderComposer({ message: "" });

    await user.type(screen.getByRole("textbox", { name: "Message" }), "你好");
    await user.selectOptions(screen.getByRole("combobox", { name: "Model" }), "");

    expect(props.onMessageChange).toHaveBeenCalled();
    expect(props.onModelChange).toHaveBeenCalledWith("");
  });

  it("disables send until both a message and model are available", () => {
    const { rerender } = render(
      <MessageComposer
        activeModelProfileId={null}
        activeRequestId={null}
        activeRequestCardId={null}
        message=""
        modelProfiles={modelProfiles}
        quotes={[]}
        onCancel={vi.fn()}
        onMessageChange={vi.fn()}
        onModelChange={vi.fn()}
        onRemoveQuote={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    rerender(
      <MessageComposer
        activeModelProfileId="model-1"
        activeRequestId={null}
        activeRequestCardId="another-card"
        message="Ready"
        modelProfiles={modelProfiles}
        quotes={[]}
        onCancel={vi.fn()}
        onMessageChange={vi.fn()}
        onModelChange={vi.fn()}
        onRemoveQuote={vi.fn()}
        onSubmit={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("shows a stop control while a response is active", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderComposer({ activeRequestId: "request-1", onCancel });

    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
  });
});
