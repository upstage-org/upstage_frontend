import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

interface TextOptions {
  fontSize: string;
  fontFamily: string;
  color?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  left?: string;
  top?: string;
  x?: number;
  y?: number;
}

interface TextState {
  isWriting: boolean;
  options: TextOptions;
  texts: any[];
}

export const useTextStore = defineStore('text', () => {
  const isWriting = ref(false);
  const options = ref<TextOptions>({
    fontSize: '20px',
    fontFamily: 'Josefin Sans',
  });
  const texts = ref<any[]>([]);

  const updateIsWriting = (value: boolean) => {
    isWriting.value = value;
  };

  const updateTextOptions = (newOptions: Partial<TextOptions>) => {
    options.value = { ...options.value, ...newOptions };
  };

  const addText = (text: any) => {
    texts.value.push(text);
  };

  const deleteText = (textId: string) => {
    texts.value = texts.value.filter(text => text.textId !== textId);
  };

  return {
    isWriting,
    options,
    texts,
    updateIsWriting,
    updateTextOptions,
    addText,
    deleteText,
  };
}); 