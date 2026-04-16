<script setup lang="ts">
import { useAttrs } from "vue";

withDefaults(
	defineProps<{
		as?: "input" | "select" | "textarea";
	}>(),
	{
		as: "input",
	},
);

const attrs = useAttrs();
</script>

<template>
	<component :is="as" class="ui-text-control" v-bind="attrs">
		<slot />
	</component>
</template>

<style scoped>
.ui-text-control {
	width: 100%;
	border: 1px solid rgba(100, 255, 140, 0.2);
	background: rgba(7, 17, 10, 0.96);
	color: #d6ffe0;
	font: inherit;
	outline: none;
}

input.ui-text-control,
select.ui-text-control {
	padding: 0.6rem 0.7rem;
}

textarea.ui-text-control {
	min-height: 8rem;
	resize: vertical;
	padding: 0.85rem 0.95rem;
}

.ui-text-control:focus {
	border-color: rgba(79, 255, 122, 0.65);
	box-shadow: 0 0 0 1px rgba(79, 255, 122, 0.18);
}

.ui-text-control:disabled {
	opacity: 0.45;
	cursor: not-allowed;
}
</style>
