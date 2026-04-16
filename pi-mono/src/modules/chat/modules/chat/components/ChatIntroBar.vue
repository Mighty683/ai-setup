<script setup lang="ts">
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

defineProps<{
	selectedProvider: string;
	selectedModelId: string;
	selectedThinkingLevel: ThinkingLevel;
}>();
</script>

<template>
	<section class="intro">
		<div class="prompt-line">&gt; terminal chat ready</div>
		<div class="intro-meta">
			<span>provider: {{ selectedProvider }}</span>
			<span>model: {{ selectedModelId }}</span>
			<span>thinking: {{ selectedThinkingLevel }}</span>
		</div>
	</section>
</template>

<style scoped>
.intro {
	display: flex;
	justify-content: space-between;
	gap: 1rem;
	padding: 0.85rem 1rem;
	border: 1px solid rgba(100, 255, 140, 0.14);
	background: rgba(9, 22, 12, 0.65);
}

.prompt-line {
	color: #4fff7a;
}

.intro-meta {
	display: flex;
	gap: 1rem;
	flex-wrap: wrap;
	color: rgba(156, 255, 178, 0.68);
	font-size: 0.84rem;
}

@media (max-width: 720px) {
	.intro {
		display: flex;
		flex-direction: column;
	}
}
</style>
