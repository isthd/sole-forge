/** 厚底ローカット 1 型「platform-01」。分厚いソールとローカットのアッパー。 */
import { defineSneaker, type SneakerParams } from './sneakerBuilder';
import { HIGHTOP01_PARAMS } from './hightop01';

const LIFT = 0.26; // ソールを厚くした分だけアッパーを持ち上げる

export const PLATFORM01_PARAMS: SneakerParams = {
  ...HIGHTOP01_PARAMS,
  outsoleThickness: 0.16,
  soleThickness: 0.36 + LIFT,
  toeSpring: 0.1,
  throatHeight: 0.88 + LIFT,
  collarHeight: 1.1 + LIFT,
  collarBackHeight: 1.22 + LIFT,
  collarDip: 0.1,
};

export const platform01 = defineSneaker('platform-01', '厚底ロー 01', 'ボリュームのある厚底ソールのローカット', PLATFORM01_PARAMS);
