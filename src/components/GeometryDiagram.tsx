import { useTranslation } from 'react-i18next';

/**
 * Static SVG schematic of the microstrip cross-section, used inside the
 * parameter form to remind the user what each input dimension means. The
 * geometry here is *illustrative*; it is not driven by the actual W/h/t/εr
 * values — `CrossSectionPlot` does that for the FEM result.
 *
 * Layout note: substrate spans SUB_LEFT…SUB_RIGHT, conductor is centred on
 * the substrate's mid-x, and the t- / h-dimension lines live to the right
 * of the conductor / substrate respectively so they don't overlap fills.
 */
export function GeometryDiagram(): React.ReactElement {
  const { t } = useTranslation();

  // viewBox-space geometry. Tuned for 280 × 170; CSS scales it.
  const SUB_LEFT = 16;
  const SUB_RIGHT = 226;
  const SUB_TOP = 70;
  const SUB_BOTTOM = 130;
  const SUB_CENTER_X = (SUB_LEFT + SUB_RIGHT) / 2;
  const COND_HALF_W = 40;
  const W_LEFT = SUB_CENTER_X - COND_HALF_W;
  const W_RIGHT = SUB_CENTER_X + COND_HALF_W;
  const COND_TOP = 60;
  const COND_BOTTOM = SUB_TOP;
  const GND_TOP = SUB_BOTTOM;
  const GND_BOTTOM = 138;
  const DIM_W_Y = 42; // dimension line for W (above conductor)
  const DIM_T_X = W_RIGHT + 18; // small t-dimension just right of conductor
  const DIM_H_X = SUB_RIGHT + 16; // h-dimension outside substrate's right edge

  const conductor = 'var(--color-conductor)';
  const substrate = 'var(--color-substrate)';
  const dimStroke = 'var(--color-text-muted)';
  const dimText = 'var(--color-text)';

  return (
    <figure className="geometry-diagram">
      <svg
        viewBox="0 0 280 170"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label={t('geometry.ariaLabel')}
      >
        {/* substrate */}
        <rect
          x={SUB_LEFT}
          y={SUB_TOP}
          width={SUB_RIGHT - SUB_LEFT}
          height={SUB_BOTTOM - SUB_TOP}
          fill={substrate}
          fillOpacity={0.65}
          stroke={substrate}
          strokeWidth={0.5}
        />
        {/* ground plane (same metal as the signal trace, so colour matches) */}
        <rect
          x={SUB_LEFT}
          y={GND_TOP}
          width={SUB_RIGHT - SUB_LEFT}
          height={GND_BOTTOM - GND_TOP}
          fill={conductor}
        />
        {/* signal conductor — centred on the substrate */}
        <rect
          x={W_LEFT}
          y={COND_TOP}
          width={W_RIGHT - W_LEFT}
          height={COND_BOTTOM - COND_TOP}
          fill={conductor}
        />

        {/* εr label inside substrate */}
        <text
          x={SUB_CENTER_X}
          y={(SUB_TOP + SUB_BOTTOM) / 2 + 6}
          textAnchor="middle"
          fontSize={19}
          fontStyle="italic"
          fill="white"
          fontFamily="var(--font-sans)"
        >
          ε
          <tspan fontSize={13} dy={4}>
            r
          </tspan>
        </text>

        {/* W dimension line (above conductor) */}
        <g stroke={dimStroke} strokeWidth={0.8} fill="none">
          <line x1={W_LEFT} y1={DIM_W_Y} x2={W_RIGHT} y2={DIM_W_Y} />
          <line
            x1={W_LEFT}
            y1={COND_TOP - 2}
            x2={W_LEFT}
            y2={DIM_W_Y - 4}
            strokeDasharray="2,2"
          />
          <line
            x1={W_RIGHT}
            y1={COND_TOP - 2}
            x2={W_RIGHT}
            y2={DIM_W_Y - 4}
            strokeDasharray="2,2"
          />
          <polygon
            points={`${W_LEFT},${DIM_W_Y} ${W_LEFT + 5},${DIM_W_Y - 3} ${W_LEFT + 5},${DIM_W_Y + 3}`}
            fill={dimStroke}
            stroke="none"
          />
          <polygon
            points={`${W_RIGHT},${DIM_W_Y} ${W_RIGHT - 5},${DIM_W_Y - 3} ${W_RIGHT - 5},${DIM_W_Y + 3}`}
            fill={dimStroke}
            stroke="none"
          />
        </g>
        <text
          x={SUB_CENTER_X}
          y={DIM_W_Y - 6}
          textAnchor="middle"
          fontSize={18}
          fontStyle="italic"
          fill={dimText}
          fontFamily="var(--font-sans)"
        >
          W
        </text>

        {/* t dimension line (right of conductor) */}
        <g stroke={dimStroke} strokeWidth={0.8} fill="none">
          <line x1={DIM_T_X} y1={COND_TOP} x2={DIM_T_X} y2={COND_BOTTOM} />
          <line
            x1={W_RIGHT + 1}
            y1={COND_TOP}
            x2={DIM_T_X + 3}
            y2={COND_TOP}
            strokeDasharray="2,2"
          />
          <line
            x1={W_RIGHT + 1}
            y1={COND_BOTTOM}
            x2={DIM_T_X + 3}
            y2={COND_BOTTOM}
            strokeDasharray="2,2"
          />
          <polygon
            points={`${DIM_T_X},${COND_TOP} ${DIM_T_X - 3},${COND_TOP + 4} ${DIM_T_X + 3},${COND_TOP + 4}`}
            fill={dimStroke}
            stroke="none"
          />
          <polygon
            points={`${DIM_T_X},${COND_BOTTOM} ${DIM_T_X - 3},${COND_BOTTOM - 4} ${DIM_T_X + 3},${COND_BOTTOM - 4}`}
            fill={dimStroke}
            stroke="none"
          />
        </g>
        <text
          x={DIM_T_X + 6}
          y={(COND_TOP + COND_BOTTOM) / 2 + 5}
          fontSize={18}
          fontStyle="italic"
          fill={dimText}
          fontFamily="var(--font-sans)"
        >
          t
        </text>

        {/* h dimension line (right of substrate) */}
        <g stroke={dimStroke} strokeWidth={0.8} fill="none">
          <line x1={DIM_H_X} y1={SUB_TOP} x2={DIM_H_X} y2={SUB_BOTTOM} />
          <line
            x1={SUB_RIGHT}
            y1={SUB_TOP}
            x2={DIM_H_X + 3}
            y2={SUB_TOP}
            strokeDasharray="2,2"
          />
          <line
            x1={SUB_RIGHT}
            y1={SUB_BOTTOM}
            x2={DIM_H_X + 3}
            y2={SUB_BOTTOM}
            strokeDasharray="2,2"
          />
          <polygon
            points={`${DIM_H_X},${SUB_TOP} ${DIM_H_X - 3},${SUB_TOP + 5} ${DIM_H_X + 3},${SUB_TOP + 5}`}
            fill={dimStroke}
            stroke="none"
          />
          <polygon
            points={`${DIM_H_X},${SUB_BOTTOM} ${DIM_H_X - 3},${SUB_BOTTOM - 5} ${DIM_H_X + 3},${SUB_BOTTOM - 5}`}
            fill={dimStroke}
            stroke="none"
          />
        </g>
        <text
          x={DIM_H_X + 6}
          y={(SUB_TOP + SUB_BOTTOM) / 2 + 5}
          fontSize={18}
          fontStyle="italic"
          fill={dimText}
          fontFamily="var(--font-sans)"
        >
          h
        </text>

        {/* Ground label */}
        <text
          x={SUB_LEFT}
          y={GND_BOTTOM + 14}
          fontSize={13}
          fill={dimStroke}
          fontFamily="var(--font-sans)"
        >
          {t('geometry.ground')}
        </text>
      </svg>
    </figure>
  );
}
