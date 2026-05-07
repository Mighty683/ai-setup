<script setup lang="ts">
import { ref } from "vue";
import { useOutsideClick } from "~src/core/ui/composables/useOutsideClick";

const props = withDefaults(
	defineProps<{
		open?: boolean;
	}>(),
	{
		open: true,
	},
);

const emit = defineEmits<{
	(e: "close"): void;
}>();

const panelElement = ref<HTMLElement | null>(null);

useOutsideClick({
	getElement: () => panelElement.value,
	isEnabled: () => props.open,
	onOutsideClick: () => emit("close"),
});
</script>

<template>
	<section v-if="props.open" ref="panelElement" class="ui-popover-panel" @click.stop>
		<slot />
	</section>
</template>

<style scoped>
.ui-popover-panel {
	position: absolute;
	top: calc(100% - 0.1rem);
	left: 1rem;
	z-index: 30;
	width: min(28rem, calc(100vw - 1.5rem));
	max-height: min(62vh, 26rem);
	overflow: auto;
	padding: 0.75rem;
	border: 1px solid rgba(100, 255, 140, 0.2);
	background: rgba(5, 14, 8, 0.98);
	box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
}

@media (max-width: 720px) {
	.ui-popover-panel {
		left: 0.75rem;
		right: 0.75rem;
		width: auto;
		max-height: min(58vh, 22rem);
	}
}
</style>
