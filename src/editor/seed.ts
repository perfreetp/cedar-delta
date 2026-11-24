import { createInstance, uid } from './utils';
import { DesignDocument } from './types';

export function createSeedDocument(): DesignDocument {
  const base: DesignDocument = {
    app: 'banquet-floral-editor',
    version: 1,
    tableRadius: 4.5,
    instances: [],
    groups: [],
  };

  const center = createInstance('hydrangea', 1);
  center.position = [0, 0, 0];
  center.scale = [1.15, 1.15, 1.15];
  center.vaseHeight = 0.22;
  base.instances.push(center);

  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const rose = createInstance('rose', i + 1);
    const r = 0.62 + (i % 2) * 0.08;
    rose.position = [Math.cos(a) * r, 0, Math.sin(a) * r];
    rose.rotation = [0.08 * Math.sin(i), -a + Math.PI / 2, 0.12 * Math.cos(i)];
    rose.vaseHeight = 0.16;
    base.instances.push(rose);
  }

  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    const leaf = createInstance('eucalyptus', i + 1);
    const r = 0.95 + (i % 2) * 0.16;
    leaf.position = [Math.cos(a) * r, 0, Math.sin(a) * r];
    leaf.rotation = [0.12, -a + Math.PI / 2, (i % 2 ? 0.22 : -0.22)];
    leaf.scale = [1.08, 1.08, 1.08];
    leaf.vaseHeight = 0.1;
    base.instances.push(leaf);
  }

  const groupId = uid('group');
  base.groups.push({
    id: groupId,
    name: '示例主桌花',
    memberIds: base.instances.map((i) => i.id),
    createdAt: Date.now(),
  });
  for (const item of base.instances) item.groupId = groupId;
  return base;
}
