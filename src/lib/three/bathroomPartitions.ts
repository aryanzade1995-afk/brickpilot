import type { Object3D } from 'three'

/** Also suppress partitions in previously exported houses, before collision
 * extraction. Keep exterior windows, shower hardware and other glass intact. */
export function hideBathroomPartitions(root: Object3D) {
  root.traverse(object => {
    if (/shower[-_]glass|selected[-_]shower[-_]enclosure|enclosure[-_](?:post|door|handle|slide)/i.test(object.name) || object.userData.spec_item === 'bath-enclosure') object.visible = false
  })
}
