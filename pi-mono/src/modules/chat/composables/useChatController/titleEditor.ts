import type { Ref } from "vue";

type CreateTitleEditorOptions = {
	currentTitle: Ref<string>;
	isEditingTitle: Ref<boolean>;
	editableTitle: Ref<string>;
	onPersistTitle: () => void;
};

export function createTitleEditor(options: CreateTitleEditorOptions) {
	function startEditingTitle() {
		options.editableTitle.value = options.currentTitle.value || "";
		options.isEditingTitle.value = true;
	}

	function setEditableTitle(value: string) {
		options.editableTitle.value = value;
	}

	function saveTitle() {
		const nextTitle = options.editableTitle.value.trim();
		if (nextTitle) {
			options.currentTitle.value = nextTitle;
			options.onPersistTitle();
		}
		options.isEditingTitle.value = false;
	}

	function cancelTitleEdit() {
		options.isEditingTitle.value = false;
	}

	function onTitleEditKeydown(event: KeyboardEvent) {
		if (event.key === "Enter") {
			event.preventDefault();
			saveTitle();
		}
		if (event.key === "Escape") {
			event.preventDefault();
			cancelTitleEdit();
		}
	}

	return {
		startEditingTitle,
		setEditableTitle,
		saveTitle,
		onTitleEditKeydown,
	};
}
