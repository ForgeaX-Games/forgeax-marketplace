import { useEffect, useState } from 'react';
import type { GlobalState, TemplateState } from '../state/GlobalState';

/** Subscribe a component to the framework-agnostic GlobalState store. */
export function useGlobalState(state: GlobalState): TemplateState {
  const [snapshot, setSnapshot] = useState<TemplateState>(() => state.get());
  useEffect(() => state.subscribe(setSnapshot), [state]);
  return snapshot;
}
