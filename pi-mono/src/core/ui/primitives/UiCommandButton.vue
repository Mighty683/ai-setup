<script setup lang="ts">
withDefaults(
	defineProps<{
		tone?: "default" | "danger";
	}>(),
	{
		tone: "default",
	},
);
</script>

<template>
	<button class="ui-command-button" :class="[`ui-command-button--${tone}`]" type="button">
		<slot />
	</button>
</template>

<style scoped>
.ui-command-button {
	padding: 0;
	border: 0;
	background: transparent;
	color: #9cffb2;
	font: inherit;
	cursor: pointer;
	text-transform: lowercase;
}

.ui-command-button::before {
	content: "[";
	color: rgba(156, 255, 178, 0.45);
}

.ui-command-button::after {
	content: "]";
	color: rgba(156, 255, 178, 0.45);
}

.ui-command-button:hover {
	color: #d6ffe0;
	text-shadow: 0 0 10px rgba(79, 255, 122, 0.35);
}

.ui-command-button:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}

.ui-command-button--danger {
	color: #ff7d7d;
}
</style>
