import { onBeforeUnmount, onMounted } from "vue";

type UseOutsideClickOptions = {
	getElement: () => HTMLElement | null;
	isEnabled?: () => boolean;
	onOutsideClick: () => void;
};

export function useOutsideClick(options: UseOutsideClickOptions) {
	function handlePointerDown(event: PointerEvent) {
		if (options.isEnabled && !options.isEnabled()) {
			return;
		}

		const element = options.getElement();
		if (!element) {
			return;
		}

		const target = event.target;
		if (!(target instanceof Node) || element.contains(target)) {
			return;
		}

		options.onOutsideClick();
	}

	onMounted(() => {
		document.addEventListener("pointerdown", handlePointerDown);
	});

	onBeforeUnmount(() => {
		document.removeEventListener("pointerdown", handlePointerDown);
	});
}
