/** ハイカット 1 型「hightop-01」。くるぶしを覆う高い履き口。 */
import { defineSneaker, type SneakerParams } from './sneakerBuilder';

export const HIGHTOP01_PARAMS: SneakerParams = {
  length: 3.0, // 全長
  halfWidth: 0.56, // ボール部の半幅
  superN: 2.4, // 足形の丸み（スーパー楕円の指数）
  outsoleThickness: 0.1,
  soleThickness: 0.36, // ソール上面の高さ
  toeSpring: 0.14, // つま先の反り
  throatHeight: 0.92, // 履き口（甲）前端の高さ
  collarHeight: 1.8, // 履き口前側の高さ
  collarBackHeight: 2.0, // 履き口うしろの高さ（ハイカット）
  collarDip: 0,
};

export const hightop01 = defineSneaker('hightop-01', 'ハイカット 01', 'くるぶしまで包む定番のハイカット', HIGHTOP01_PARAMS);
