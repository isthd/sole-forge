/** ローカット 1 型「lowtop-01」。くるぶしの下で履き口が切れ込む。 */
import { defineSneaker, type SneakerParams } from './sneakerBuilder';
import { HIGHTOP01_PARAMS } from './hightop01';

export const LOWTOP01_PARAMS: SneakerParams = {
  ...HIGHTOP01_PARAMS,
  throatHeight: 0.88,
  collarHeight: 1.1,
  collarBackHeight: 1.22,
  collarDip: 0.1,
};

export const lowtop01 = defineSneaker('lowtop-01', 'ローカット 01', '足首が出るシンプルなローカット', LOWTOP01_PARAMS);
