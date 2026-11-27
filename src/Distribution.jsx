import React from "react";

export function Boxplot({ groups, unit }) {
  const valid = groups.filter((group) => group.summary.length === 5);
  if (!valid.length) return null;
  const min = Math.min(...valid.map((group) => group.summary[0]));
  const max = Math.max(...valid.map((group) => group.summary[4]));
  const position = (value) =>
    max === min ? 350 : 110 + (520 * (value - min)) / (max - min);
  const height = 50 + 38 * valid.length;
  return (
    <svg
      className="pca-plot"
      viewBox={`0 0 680 ${height}`}
      role="img"
      aria-label="Distribución mediante diagramas de caja"
    >
      {valid.map(({ label, summary }, index) => {
        const y = 22 + 38 * index;
        const [low, q1, middle, q3, high] = summary.map(position);
        return (
          <g key={label}>
            <title>
              {label} · {summary.map((value) => value.toFixed(2)).join(" / ")}{" "}
              {unit}
            </title>
            <text x="4" y={y + 4}>
              {label}
            </text>
            <line x1={low} x2={high} y1={y} y2={y} stroke="currentColor" />
            <path
              d={`M${low} ${y - 7}v14 M${high} ${y - 7}v14`}
              stroke="currentColor"
            />
            <rect
              x={q1}
              y={y - 11}
              width={Math.max(q3 - q1, 1)}
              height="22"
              fill="#158877"
              stroke="currentColor"
            />
            <path d={`M${middle} ${y - 11}v22`} stroke="#fff" />
          </g>
        );
      })}
      <text x="110" y={height - 10}>
        {min.toFixed(2)}
      </text>
      <text x="630" y={height - 10} textAnchor="end">
        {max.toFixed(2)} {unit}
      </text>
    </svg>
  );
}

export function Histogram({ values, unit }) {
  const data = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (data.length < 3)
    return <p>Se requieren al menos tres valores disponibles.</p>;
  const min = data[0],
    max = data.at(-1);
  const count =
    min === max ? 1 : Math.min(20, Math.ceil(Math.sqrt(data.length)));
  const step = (max - min) / count;
  const bins = Array(count).fill(0);
  for (const value of data)
    bins[step ? Math.min(count - 1, Math.floor((value - min) / step)) : 0]++;
  const maxCount = Math.max(...bins);
  return (
    <svg
      className="pca-plot"
      viewBox="0 0 680 216"
      role="img"
      aria-label="Histograma de frecuencias"
    >
      <path d="M42 22V185H645" fill="none" stroke="currentColor" />
      <text x="42" y="16">
        Frecuencia · máximo {maxCount}
      </text>
      {bins.map((frequency, index) => (
        <rect
          key={index}
          x={44 + (index * 590) / count}
          y={185 - (150 * frequency) / maxCount}
          width={590 / count - 2}
          height={(150 * frequency) / maxCount}
          fill="#158877"
        >
          <title>
            {(min + index * step).toFixed(3)} a{" "}
            {(min + (index + 1) * step).toFixed(3)} {unit} · {frequency}{" "}
            registros
          </title>
        </rect>
      ))}
      <text x="42" y="207">
        {min.toFixed(2)}
      </text>
      <text x="645" y="207" textAnchor="end">
        {max.toFixed(2)} {unit}
      </text>
    </svg>
  );
}
