<script setup lang="ts">
import type { PendingImage } from "~src/core/chat/types/chat";

defineProps<{
	pendingImages: readonly PendingImage[];
}>();

const emit = defineEmits<{
	remove: [imageId: string];
}>();

function handleRemove(imageId: string) {
	emit("remove", imageId);
}
</script>

<template>
	<div v-if="pendingImages.length > 0" class="pending-images">
		<div v-for="image in pendingImages" :key="image.id" class="pending-image-card">
			<img class="pending-image-preview" :src="image.previewUrl" :alt="image.name" />
			<div class="pending-image-meta">
				<div>{{ image.name }}</div>
				<button class="command" type="button" @click="handleRemove(image.id)">remove</button>
			</div>
		</div>
	</div>
</template>

<style scoped>
.pending-images {
	display: flex;
	gap: 0.85rem;
	flex-wrap: wrap;
}

.pending-image-card {
	display: grid;
	grid-template-columns: 5rem minmax(0, 1fr);
	gap: 0.75rem;
	align-items: center;
	padding: 0.6rem;
	border: 1px solid rgba(100, 255, 140, 0.18);
	background: rgba(9, 22, 12, 0.7);
	min-width: 16rem;
}

.pending-image-preview {
	display: block;
	max-width: 100%;
	border: 1px solid rgba(100, 255, 140, 0.2);
	width: 5rem;
	height: 5rem;
	object-fit: cover;
}

.pending-image-meta {
	display: grid;
	gap: 0.45rem;
	min-width: 0;
}

.command {
	padding: 0;
	border: 0;
	background: transparent;
	color: #9cffb2;
	font: inherit;
	cursor: pointer;
	text-transform: lowercase;
	justify-self: start;
}

.command::before {
	content: "[";
	color: rgba(156, 255, 178, 0.45);
}

.command::after {
	content: "]";
	color: rgba(156, 255, 178, 0.45);
}

.command:hover {
	color: #d6ffe0;
	text-shadow: 0 0 10px rgba(79, 255, 122, 0.35);
}
</style>
