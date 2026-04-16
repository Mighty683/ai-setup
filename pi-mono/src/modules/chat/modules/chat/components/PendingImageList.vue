<script setup lang="ts">
import type { PendingImage } from "~src/modules/chat/modules/chat/shared/types/chat";
import UiCommandButton from "~src/core/ui/primitives/UiCommandButton.vue";

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
				<UiCommandButton class="remove-button" @click="handleRemove(image.id)">remove</UiCommandButton>
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

.remove-button {
	justify-self: start;
}
</style>
