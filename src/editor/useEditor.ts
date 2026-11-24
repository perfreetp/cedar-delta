import { useSyncExternalStore } from 'react';
import { EditorController } from './EditorController';

let controllerSingleton: EditorController | null = null;

export function getEditorController(): EditorController {
  if (!controllerSingleton) controllerSingleton = new EditorController();
  return controllerSingleton;
}

export function useEditor(): EditorController {
  const controller = getEditorController();
  useSyncExternalStore(controller.subscribe, controller.getVersion, controller.getVersion);
  return controller;
}
