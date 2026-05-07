<script setup lang="ts">
import type { ThinkingLevel } from "~src/modules/chat/modules/chat/shared/types/chat";

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
	gap: 0.65rem;
	padding: 0.6rem 0.75rem;
	border: 1px solid rgba(100, 255, 140, 0.14);
	background: rgba(9, 22, 12, 0.65);
}

.prompt-line {
	color: #4fff7a;
	font-size: 0.88rem;
}

.intro-meta {
	display: flex;
	gap: 0.65rem;
	flex-wrap: wrap;
	color: rgba(156, 255, 178, 0.68);
	font-size: 0.78rem;
}

@media (max-width: 720px) {
	.intro {
		display: flex;
		flex-direction: column;
	}
}
</style>
