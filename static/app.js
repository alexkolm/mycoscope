// Сворачивание/разворачивание блока "О проекте / Как пользоваться".
// Обе кнопки "Свернуть описание" (сверху и снизу текста) делают одно и то же;
// в свёрнутом виде вместо них остаётся одна кнопка "Развернуть описание".
const descBlockExpanded = document.getElementById("descBlockExpanded");
const toggleTop = document.getElementById("toggleTop");
const toggleBottom = document.getElementById("toggleBottom");
const toggleCollapsed = document.getElementById("toggleCollapsed");

function setDescCollapsed(collapsed) {
  descBlockExpanded.style.display = collapsed ? "none" : "block";
  toggleCollapsed.style.display = collapsed ? "inline-block" : "none";
}

toggleTop.addEventListener("click", () => setDescCollapsed(true));
toggleBottom.addEventListener("click", () => setDescCollapsed(true));
toggleCollapsed.addEventListener("click", () => setDescCollapsed(false));

// Стартовая точка карты по умолчанию. Реальную точку пользователь может
// поставить кликом на карте или ввести вручную.
const DEFAULT_CENTER = [56.838, 60.445];

const map = L.map("map").setView(DEFAULT_CENTER, 6);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors",
  maxZoom: 18,
}).addTo(map);

let marker = null;
let lastWeatherData = null; // сохраняем последний ответ для кнопки "Анализ (промт)"
let tempChart = null; // текущий экземпляр графика температуры (для пересоздания)
let precipChart = null; // текущий экземпляр графика осадков (для пересоздания)
let soilChart = null; // текущий экземпляр графика влажности почвы (для пересоздания)

const coordsInput = document.getElementById("coordsInput");
const statusEl = document.getElementById("status");
const tableWrap = document.getElementById("tableWrap");
const promptBtn = document.getElementById("promptBtn");
const copiedMsg = document.getElementById("copiedMsg");
const chartSection = document.getElementById("chartSection");
const precipChartSection = document.getElementById("precipChartSection");
const soilChartSection = document.getElementById("soilChartSection");
const speciesListEl = document.getElementById("speciesList");
const speciesWarning = document.getElementById("speciesWarning");

// Виды грибов для чекбоксов. По умолчанию включены три основных
// (белый, лисичка, рыжик) — остальные пользователь включает сам.
const SPECIES_LIST = [
  { id: "white", ru: "Белый гриб", lat: "Boletus edulis", icon: "icons/white.png", checked: true },
  { id: "chanterelle", ru: "Лисичка настоящая", lat: "Cantharellus cibarius", icon: "icons/chanterelle.png", checked: true },
  { id: "ryzhik", ru: "Рыжик настоящий", lat: "Lactarius deliciosus", icon: "icons/ryzhik.png", checked: true },
  { id: "aspen_bolete", ru: "Подосиновик красный", lat: "Leccinum aurantiacum", icon: "icons/aspen_bolete.png", checked: false },
  { id: "birch_bolete", ru: "Подберёзовик обыкновенный", lat: "Leccinum scabrum", icon: "icons/birch_bolete.png", checked: false },
  { id: "russula_delica", ru: "Подгруздок белый", lat: "Russula delica", icon: "icons/russula_delica.png", checked: false },
  { id: "honey_fungus", ru: "Опёнок осенний", lat: "Armillaria ostoyae", icon: "icons/honey_fungus.png", checked: false },
];

function renderSpeciesList() {
  speciesListEl.innerHTML = SPECIES_LIST.map(
    (sp) => `
    <label class="species-item">
      <input type="checkbox" data-species-id="${sp.id}" ${sp.checked ? "checked" : ""} />
      <img src="${sp.icon}" alt="" class="species-icon" />
      <span class="species-text"><strong>${sp.ru}</strong> <em>(${sp.lat})</em></span>
    </label>`
  ).join("");
}
renderSpeciesList();

function getSelectedSpecies() {
  const boxes = speciesListEl.querySelectorAll('input[type="checkbox"]:checked');
  return Array.from(boxes)
    .map((el) => SPECIES_LIST.find((sp) => sp.id === el.dataset.speciesId))
    .filter(Boolean);
}

// "2026-07-16" -> "16.07" — короткий формат для таблицы, без года
function formatDateShort(isoDate) {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const [, mm, dd] = parts;
  return `${dd}.${mm}`;
}

function setMarker(lat, lon) {
  if (marker) {
    marker.setLatLng([lat, lon]);
  } else {
    marker = L.marker([lat, lon]).addTo(map);
  }
  coordsInput.value = `${lat}, ${lon}`;
}
setMarker(...DEFAULT_CENTER);

// Клик по карте — ставим/двигаем маркер и заполняем текстовое поле
map.on("click", (e) => {
  setMarker(e.latlng.lat, e.latlng.lng);
});

function parseCoords(text) {
  const parts = text.split(",").map((s) => s.trim());
  if (parts.length !== 2) return null;
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

// Ручной ввод координат — тоже двигает маркер на карте
coordsInput.addEventListener("change", () => {
  const parsed = parseCoords(coordsInput.value);
  if (parsed) {
    if (marker) {
      marker.setLatLng([parsed.lat, parsed.lon]);
    } else {
      marker = L.marker([parsed.lat, parsed.lon]).addTo(map);
    }
    map.panTo([parsed.lat, parsed.lon]);
  }
});

function renderTable(data) {
  const { labels, params_order, rows } = data;

  let html = "<table><thead><tr><th>Дата</th>";
  for (const key of params_order) {
    html += `<th>${labels[key]}</th>`;
  }
  html += "</tr></thead><tbody>";

  for (const row of rows) {
    html += `<tr><td>${formatDateShort(row.date)}</td>`;
    for (const key of params_order) {
      const v = row[key];
      html += `<td>${v === null || v === undefined ? "—" : v}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  tableWrap.innerHTML = html;
}

function buildPromptText(data, selectedSpecies) {
  const { lat, lon, region, labels, params_order, rows } = data;

  const header = params_order.map((k) => labels[k]).join(" | ");
  const lines = rows.map((row) => {
    const values = params_order.map((k) => (row[k] === null ? "-" : row[k]));
    return `${row.date}: ${values.join(" | ")}`;
  });

  const speciesText = selectedSpecies.map((sp) => `${sp.ru} (${sp.lat})`).join(", ");
  const regionText = region ? `регион: ${region}` : "регион по координатам не определён";

  return (
    `Параметры погоды по дням: Дата | ${header}\n` +
    lines.join("\n") +
    `\n\nЭто данные погоды за последние ${rows.length} дней в точке с координатами ${lat}, ${lon} (${regionText}). ` +
    `Оцени вероятность созревания грибов: ${speciesText} в этой точке ` +
    `с учётом приведённых погодных условий, и через сколько дней ожидать пик плодоношения.`
  );
}

function renderChart(data) {
  const { rows } = data;
  const labels = rows.map((r) => formatDateShort(r.date));

  const datasetTmax = {
    label: "T макс, °C",
    data: rows.map((r) => r.temperature_2m_max),
    borderColor: "#c0392b",
    backgroundColor: "#c0392b",
    tension: 0.25,
    spanGaps: true,
  };
  const datasetTmin = {
    label: "T мин, °C",
    data: rows.map((r) => r.temperature_2m_min),
    borderColor: "#2b6cc0",
    backgroundColor: "#2b6cc0",
    tension: 0.25,
    spanGaps: true,
  };
  const datasetSoil = {
    label: "T почвы, °C",
    data: rows.map((r) => r.soil_temperature_0_to_7cm_mean),
    borderColor: "#2f9e44",
    backgroundColor: "#2f9e44",
    tension: 0.25,
    spanGaps: true,
  };

  if (tempChart) {
    tempChart.destroy();
  }

  const ctx = document.getElementById("tempChart").getContext("2d");
  tempChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [datasetTmin, datasetTmax, datasetSoil] },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      scales: {
        y: { title: { display: true, text: "°C" } },
      },
    },
  });

  chartSection.style.display = "block";
}

function renderPrecipChart(data) {
  const { rows } = data;
  const labels = rows.map((r) => formatDateShort(r.date));

  const dataset = {
    label: "Осадки, мм",
    data: rows.map((r) => r.precipitation_sum),
    backgroundColor: "rgba(52, 152, 219, 0.55)", // голубой, полупрозрачный
    borderColor: "#2980b9",
    borderWidth: 1,
    borderRadius: 3,
  };

  if (precipChart) {
    precipChart.destroy();
  }

  const ctx = document.getElementById("precipChart").getContext("2d");
  precipChart = new Chart(ctx, {
    type: "bar",
    data: { labels, datasets: [dataset] },
    options: {
      responsive: true,
      scales: {
        y: { beginAtZero: true, title: { display: true, text: "мм" } },
      },
    },
  });

  precipChartSection.style.display = "block";
}

// Границы зон объёмной влажности почвы (м³/м³), актуальные для суглинистых
// лесных почв Урала: ~0.15 — точка увядания (засуха), 0.25-0.30 — полевая
// влагоёмкость (приемлемо, но не пик), от 0.35 — почва близка к насыщению.
const SOIL_ZONE_DRY = 0.15;
const SOIL_ZONE_MID_LOW = 0.25;
const SOIL_ZONE_MID_HIGH = 0.30;
const SOIL_ZONE_WET = 0.35;
const SOIL_SCALE_MIN = 0.05;
const SOIL_SCALE_MAX = 0.45;

const soilMoistureBgPlugin = {
  id: "soilMoistureBg",
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    const yScale = scales.y;
    const yMin = yScale.min;
    const yMax = yScale.max;

    const toOffset = (v) => {
      const clamped = Math.min(yMax, Math.max(yMin, v));
      return (yMax - clamped) / (yMax - yMin || 1);
    };

    const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    // Стопы сверху (высокая влажность) вниз (низкая): насыщенный зелёный ->
    // плавный переход -> нейтральный -> плавный переход -> жёлто-коричневый.
    const stops = [
      { v: yMax, color: "#4caf50" },
      { v: SOIL_ZONE_WET, color: "#4caf50" },
      { v: SOIL_ZONE_MID_HIGH, color: "#d8d3bf" },
      { v: SOIL_ZONE_MID_LOW, color: "#d8d3bf" },
      { v: SOIL_ZONE_DRY, color: "#c9922f" },
      { v: yMin, color: "#c9922f" },
    ];
    stops.forEach((s) => gradient.addColorStop(toOffset(s.v), s.color));

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = gradient;
    ctx.fillRect(
      chartArea.left,
      chartArea.top,
      chartArea.right - chartArea.left,
      chartArea.bottom - chartArea.top
    );
    ctx.restore();
  },
};

function renderSoilMoistureChart(data) {
  const { rows } = data;
  const labels = rows.map((r) => formatDateShort(r.date));

  const dataset = {
    label: "Влажность почвы, м³/м³",
    data: rows.map((r) => r.soil_moisture_0_to_7cm_mean),
    borderColor: "#1b263b",
    backgroundColor: "#1b263b",
    pointRadius: 3,
    tension: 0.25,
    spanGaps: true,
  };

  if (soilChart) {
    soilChart.destroy();
  }

  const ctx = document.getElementById("soilChart").getContext("2d");
  soilChart = new Chart(ctx, {
    type: "line",
    data: { labels, datasets: [dataset] },
    options: {
      responsive: true,
      scales: {
        y: {
          suggestedMin: SOIL_SCALE_MIN,
          suggestedMax: SOIL_SCALE_MAX,
          title: { display: true, text: "м³/м³" },
        },
      },
    },
    plugins: [soilMoistureBgPlugin],
  });

  soilChartSection.style.display = "block";
}

document.getElementById("fetchBtn").addEventListener("click", async () => {
  const parsed = parseCoords(coordsInput.value);
  if (!parsed) {
    statusEl.textContent = "Введите координаты в формате: широта, долгота";
    return;
  }
  setMarker(parsed.lat, parsed.lon);
  map.panTo([parsed.lat, parsed.lon]);

  const days = parseInt(document.getElementById("daysSelect").value, 10);

  statusEl.textContent = "Загружаю данные Open-Meteo...";
  tableWrap.innerHTML = "";
  promptBtn.style.display = "none";
  copiedMsg.style.display = "none";
  chartSection.style.display = "none";
  precipChartSection.style.display = "none";
  soilChartSection.style.display = "none";
  speciesWarning.style.display = "none";

  try {
    const resp = await fetch("/api/weather", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: parsed.lat, lon: parsed.lon, days }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `Ошибка сервера: ${resp.status}`);
    }
    const data = await resp.json();
    lastWeatherData = data;
    statusEl.textContent = "";
    renderTable(data);
    renderChart(data);
    renderPrecipChart(data);
    renderSoilMoistureChart(data);
    promptBtn.style.display = "inline-block";
  } catch (e) {
    statusEl.textContent = `Не получилось загрузить погоду: ${e.message}`;
  }
});

promptBtn.addEventListener("click", async () => {
  if (!lastWeatherData) return;

  const selectedSpecies = getSelectedSpecies();
  if (selectedSpecies.length === 0) {
    speciesWarning.textContent = "Выбери хотя бы один вид гриба, чтобы сформировать промт.";
    speciesWarning.style.display = "block";
    return;
  }
  speciesWarning.style.display = "none";

  const text = buildPromptText(lastWeatherData, selectedSpecies);
  try {
    await navigator.clipboard.writeText(text);
    copiedMsg.style.display = "block";
    setTimeout(() => (copiedMsg.style.display = "none"), 3000);
  } catch (e) {
    // Фолбэк на случай, если clipboard API недоступен (например, не https)
    prompt("Скопируй текст вручную:", text);
  }
});
