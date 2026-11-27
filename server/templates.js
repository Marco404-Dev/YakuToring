export const templates = [
  { name: "yakutoring_alerta_prueba", title: "Alerta de prueba", fields: [] },
  {
    name: "yakutoring_alerta_ambiental",
    title: "Alerta ambiental",
    fields: ["Parámetro afectado", "Valor registrado", "Fecha y hora"],
  },
  {
    name: "yakutoring_posible_riesgo_ambiental",
    title: "Posible riesgo ambiental",
    fields: [
      "Parámetro afectado",
      "Valor registrado",
      "Tiempo de persistencia (manual)",
      "Fecha y hora",
    ],
  },
  {
    name: "yakutoring_reporte_diario",
    title: "Reporte diario",
    fields: [
      "Fecha",
      "Temperatura promedio (°C)",
      "pH promedio (real si está disponible; de lo contrario, simulación)",
      "Salinidad (ppt, simulada)",
      "Oxígeno disuelto (mg/L, simulado)",
      "Cantidad de mediciones",
      "Estado general (manual)",
      "Anomalías (manual, sin detección automática)",
    ],
  },
];
export function diagnosticValues(name, values) {
  const field = name === "yakutoring_reporte_diario" ? 6 : 0;
  return values.map((value, index) =>
    index === field ? `[PRUEBA] ${value}` : value,
  );
}
export function payload(template, values, language, recipient) {
  if (
    !template ||
    !Array.isArray(values) ||
    values.length !== template.fields.length ||
    values.some((v) => typeof v !== "string" || !v.trim() || v.length > 500)
  )
    throw new Error(
      "Complete todos los parámetros (máximo 500 caracteres por campo).",
    );
  return {
    messaging_product: "whatsapp",
    to: recipient,
    type: "template",
    template: {
      name: template.name,
      language: { code: language },
      ...(values.length
        ? {
            components: [
              {
                type: "body",
                parameters: values.map((text) => ({
                  type: "text",
                  text: text.trim(),
                })),
              },
            ],
          }
        : {}),
    },
  };
}
