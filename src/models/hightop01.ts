/**
 * ランニング型「ランナー 01」。ローカット・かかとが厚いソール・プルタブ付き。
 * 当初はハイカットだったが作り直した。保存済みの作品と互換を保つため ID は hightop-01 のまま
 * （元のハイカットは hicut01.ts）。
 */
import { defineSneaker, type SneakerParams } from './sneakerBuilder';

export const HIGHTOP01_PARAMS: SneakerParams = {
  style: 'runner',
  length: 3.0, // 全長
  halfWidth: 0.56, // ボール部の半幅
  superN: 2.3, // 足形の丸み（スーパー楕円の指数）
  outsoleThickness: 0.06,
  soleThickness: 0.22, // ソール上面の高さ（つま先側）
  soleHeelThickness: 0.44, // ソール上面の高さ（かかと側。厚底のドロップ）
  midsoleLip: 0.1, // かかとでミッドソールがアッパーを包み込む立ち上がり
  heelRocker: 0.07, // かかと底の跳ね上げ
  toeSpring: 0.2, // つま先の反り
  throatHeight: 0.9, // 履き口（甲）前端の高さ
  collarHeight: 1.42, // 履き口前側（シューレース最上部）の高さ
  collarBackHeight: 1.3, // 履き口うしろの高さ
  collarDip: 0.26, // くるぶし付近で履き口が下がる量
  pullTab: 0.17, // かかとのプルタブの長さ
};

export const hightop01 = defineSneaker('hightop-01', 'ランナー 01', 'かかとが厚いソールのランニング型', HIGHTOP01_PARAMS, {
  target: [0, 0.7, 0],
  defaultCamera: [3.3, 2.6, 4.7],
  presets: {
    front: [5.2, 1.1, 0],
    side: [0, 0.9, 5.2],
    back: [-5.2, 1.3, 0],
    top: [0.01, 5.6, 0.01],
    threeQuarter: [3.3, 2.6, 4.7],
  },
});
