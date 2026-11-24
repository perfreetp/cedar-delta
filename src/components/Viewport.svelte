<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { RigView } from '../three/RigView';
  import {
    docStore,
    livePose,
    selectedJointId,
    clampedIds,
    hoveredJointId,
    mode,
    beginJointDrag,
    dragJoint,
    endJointDrag,
    beginPoseDrag,
    dragEndEffector,
    endPoseDrag,
    beginRodDrag,
    setRodValue,
    endRodDrag,
  } from '../stores/rig';

  let container: HTMLDivElement;
  let view: RigView;
  let modeValue: 'edit' | 'animate' = 'edit';
  let unsubMode: () => void = () => {};
  const unsubs: Array<() => void> = [];

  onMount(() => {
    view = new RigView(container, {
      getMode: () => modeValue,
      onSelect: (id) => selectedJointId.set(id),
      onHoverChange: (id) => hoveredJointId.set(id),

      onJointDragStart: () => beginJointDrag(),
      onJointDrag: (id, pos) => dragJoint(id, pos),
      onJointDragEnd: () => endJointDrag(),

      onEffectorDragStart: () => beginPoseDrag(),
      onEffectorDrag: (id, pos, root) => dragEndEffector(id, pos, root),
      onEffectorDragEnd: () => endPoseDrag(),

      onRodDragStart: () => beginRodDrag(),
      onRodDrag: (v) => setRodValue(v),
      onRodDragEnd: () => endRodDrag(),
    });

    // 订阅 store 同步到 three 层
    unsubs.push(
      docStore.subscribe((doc) => view.setSkeleton(doc.joints)),
      livePose.subscribe((pose) => view.setPose(pose)),
      selectedJointId.subscribe((id) => view.setSelection(id)),
      clampedIds.subscribe((ids) => view.setClamped(ids)),
      docStore.subscribe((doc) =>
        view.setRodVisible(modeValue === 'animate', doc.rod.min, doc.rod.max, doc.rod.value),
      ),
      docStore.subscribe((doc) => view.setRodValue(doc.rod.value)),
    );

    // 模式切换时刷新牵引杆可见性
    unsubMode = mode.subscribe((m) => {
      modeValue = m;
      const doc = $docStore;
      view?.setRodVisible(m === 'animate', doc.rod.min, doc.rod.max, doc.rod.value);
    });
  });

  onDestroy(() => {
    unsubMode();
    unsubs.forEach((u) => u());
    view?.dispose();
  });
</script>

<div class="viewport" bind:this={container}></div>

<style>
  .viewport {
    width: 100%;
    height: 100%;
    position: relative;
  }
  .viewport :global(canvas) {
    display: block;
  }
</style>
