<script setup lang="ts">
defineProps<{
	label: string;
	forId?: string;
}>();
</script>

<template>
	<div class="ui-field">
		<label class="ui-field__label" :for="forId">{{ label }}</label>
		<slot />
	</div>
</template>

<style scoped>
.ui-field {
	display: grid;
	gap: 0.4rem;
	min-width: 0;
}

.ui-field__label {
	font-size: 0.8rem;
	color: rgba(156, 255, 178, 0.72);
	text-transform: uppercase;
	letter-spacing: 0.06em;
}
</style>
