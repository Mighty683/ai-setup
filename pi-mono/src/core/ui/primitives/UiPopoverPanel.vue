<script setup lang="ts">
withDefaults(
	defineProps<{
		open?: boolean;
	}>(),
	{
		open: true,
	},
);
</script>

<template>
	<section v-if="open" class="ui-popover-panel" @click.stop>
		<slot />
	</section>
</template>

<style scoped>
.ui-popover-panel {
	position: absolute;
	top: calc(100% - 0.25rem);
	left: 1.25rem;
	z-index: 30;
	width: min(32rem, calc(100vw - 2rem));
	max-height: min(70vh, 32rem);
	overflow: auto;
	padding: 1rem;
	border: 1px solid rgba(100, 255, 140, 0.2);
	background: rgba(5, 14, 8, 0.98);
	box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45);
}

@media (max-width: 720px) {
	.ui-popover-panel {
		left: 1rem;
		right: 1rem;
		width: auto;
		max-height: min(65vh, 28rem);
	}
}
</style>
