/** ミッドカット 1 型「midcut-01」。くるぶしの高さで止まる履き口。 */
import { defineSneaker, type SneakerParams } from './sneakerBuilder';
import { HIGHTOP01_PARAMS } from './hightop01';

export const MIDCUT01_PARAMS: SneakerParams = {
  ...HIGHTOP01_PARAMS,
  collarHeight: 1.4,
  collarBackHeight: 1.58,
  collarDip: 0.06,
};

export const midcut01 = defineSneaker('midcut-01', 'ミッドカット 01', 'くるぶし丈で軽快なミッドカット', MIDCUT01_PARAMS);
