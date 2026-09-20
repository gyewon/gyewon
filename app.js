/**
 * 가계부 & 카드별 지출 대시보드 - Application Logic
 * 허계원 고객님 맞춤형 재무 분석 웹 대시보드
 */

(function () {
  'use strict';

  // --- Constants & Brand Configuration ---
  const STORAGE_KEY = 'gyewon_household_tx_sep01_10_v4';
  const THEME_KEY = 'gyewon_theme_mode';
  const RULES_STORAGE_KEY = 'gyewon_category_rules_v1';
  const MASTER_CAT_STORAGE_KEY = 'gyewon_master_categories_v1';
  const DELETED_RECORDS_KEY = 'gyewon_deleted_records_v1';

  const DEFAULT_MASTER_CATEGORIES = {
    "식비": ["외식", "배달", "카페/간식", "식재료/마트"],
    "교통/차량": ["대중교통", "택시", "주유", "정비"],
    "주거/통신": ["월세/관리비", "통신비", "가스/전기/수도"],
    "쇼핑": ["온라인쇼핑", "의류/잡화", "가전/가구", "편의점"],
    "문화/여가": ["영화/공연", "게임", "여행", "도서"],
    "건강/의료": ["병원/약국", "운동", "영양제"],
    "미용/패션": ["헤어/뷰티", "화장품"],
    "경조사/회비": ["축의금", "조의금", "모임/회비"],
    "기타": ["미분류", "현금찾기", "기타지출"]
  };

  const CARD_CONFIG = {
    '신한은행 The More': { color: '#3b82f6', chip: '#2563eb', target: 500000, type: 'physical' },
    'KT Plus 우리카드': { color: '#06b6d4', chip: '#0891b2', target: 400000, type: 'physical' },
    'MG+ S 하나카드': { color: '#ec4899', chip: '#db2777', target: 500000, type: 'physical' }, // Pink
    'KB국민 톡톡 my point카드': { color: '#f59e0b', chip: '#d97706', target: 300000, type: 'physical' },
    '신한 복지 다드림 LOVE': { color: '#ef4444', chip: '#dc2626', target: 300000, type: 'physical' },
    '아시아나 KB국민플래티늄카드': { color: '#8b5cf6', chip: '#7c3aed', target: 1000000, type: 'physical' },
    '기타 카드': { color: '#64748b', chip: '#475569', target: 0, type: 'physical' },

    '[간편결제] 네이버페이': { color: '#03c75a', dot: '#02b351', type: 'pay' }, // Naver Green
    '[간편결제] 네이버페이(포인트)': { color: '#4ade80', dot: '#22c55e', type: 'pay' },
    '[간편결제] 카카오페이': { color: '#eab308', dot: '#ca8a04', type: 'pay' },
    '[간편결제] 페이코': { color: '#f43f5e', dot: '#e11d48', type: 'pay' },
    '[간편결제] 토스': { color: '#3b82f6', dot: '#2563eb', type: 'pay' },
    '계좌/현금': { color: '#475569', dot: '#94a3b8', type: 'pay' }
  };

  const CATEGORY_COLORS = [
    '#6366f1', '#06b6d4', '#10b981', '#f59e0b', '#ec4899',
    '#8b5cf6', '#3b82f6', '#14b8a6', '#f97316', '#a855f7',
    '#64748b', '#84cc16', '#eab308', '#0284c7', '#d946ef'
  ];

  // --- State ---
  let appState = {
    records: [],
    categoryRules: [],
    masterCategories: {},
    deletedSignatures: new Set(),
    activeManageMainCat: null,
    searchQuery: '',
    filterCard: 'ALL',
    filterCategory: 'ALL',
    filterExclude: 'ALL', // 'ALL' | 'N' | 'Y'
    filterInstallment: 'ALL', // 'ALL' | '일시불' | '할부'
    sortBy: 'id',
    sortOrder: 'asc',
    currentPage: 1,
    pageSize: 30,
    activeChartTab: 'cards'
  };

  // Chart instances
  let charts = {
    doughnut: null,
    categoryBar: null,
    trendLine: null,
    dailyBar: null
  };

  // --- Helper Functions ---
  function getSignature(r) {
    return `${r.date}|${r.time || ''}|${r.merchant}|${r.amount}`;
  }

  function identifyCanceledPairs(recordsList) {
    recordsList.forEach(r => r.isCanceled = false);
    const groups = {};
    recordsList.forEach(r => {
      const key = `${r.date}|${r.merchant}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });

    for (const key in groups) {
      const group = groups[key];
      const matched = new Set();
      for (let i = 0; i < group.length; i++) {
        if (matched.has(i)) continue;
        for (let j = i + 1; j < group.length; j++) {
          if (matched.has(j)) continue;
          if (group[i].amount === -group[j].amount && group[i].amount !== 0) {
            group[i].isCanceled = true;
            group[j].isCanceled = true;
            matched.add(i);
            matched.add(j);
            break;
          }
        }
      }
    }
  }

  function formatCurrency(val) {
    return (Number(val) || 0).toLocaleString('ko-KR');
  }

  let activeToastTimer = null;
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    if (activeToastTimer) clearTimeout(activeToastTimer);
    container.innerHTML = '';

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'warn' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);

    activeToastTimer = setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 2500);
  }

  // --- Initialization ---
  function init() {
    loadData();
    initTheme();
    populateFilterDropdowns();
    attachEventListeners();
    renderAll();
  }

  function loadData() {
    try {
      const savedDeleted = localStorage.getItem(DELETED_RECORDS_KEY);
      if (savedDeleted) {
        appState.deletedSignatures = new Set(JSON.parse(savedDeleted));
      }

      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        appState.records = JSON.parse(saved);
      } else if (window.INITIAL_DATA && window.INITIAL_DATA.records) {
        let initialRecs = JSON.parse(JSON.stringify(window.INITIAL_DATA.records));
        appState.records = initialRecs.filter(r => !appState.deletedSignatures.has(getSignature(r)));
        saveData();
      }
      const beforeCount = appState.records.length;
      appState.records = appState.records.filter(r => !(r.merchant && r.merchant.includes('업비트')));
      if (appState.records.length !== beforeCount) {
        saveData();
      }

      const savedRules = localStorage.getItem(RULES_STORAGE_KEY);
      if (savedRules) {
        appState.categoryRules = JSON.parse(savedRules);
      }

      const savedMasterCats = localStorage.getItem(MASTER_CAT_STORAGE_KEY);
      if (savedMasterCats) {
        appState.masterCategories = JSON.parse(savedMasterCats);
      } else {
        appState.masterCategories = JSON.parse(JSON.stringify(DEFAULT_MASTER_CATEGORIES));
        saveMasterCategories();
      }
    } catch (e) {
      console.error('Failed to load storage data:', e);
      if (window.INITIAL_DATA) {
        appState.records = JSON.parse(JSON.stringify(window.INITIAL_DATA.records));
      }
    }
  }

  function saveData() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(appState.records));
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }

  function saveRules() {
    try {
      localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(appState.categoryRules));
    } catch (e) {
      console.error('Failed to save rules to localStorage:', e);
    }
  }

  function saveMasterCategories() {
    try {
      localStorage.setItem(MASTER_CAT_STORAGE_KEY, JSON.stringify(appState.masterCategories));
    } catch (e) {
      console.error('Failed to save master categories:', e);
    }
  }

  function applyCategoryRules(recordsList) {
    if (appState.categoryRules.length === 0) return false;
    let changed = false;
    recordsList.forEach(rec => {
      const merchant = rec.merchant || '';
      for (const rule of appState.categoryRules) {
        if (merchant.includes(rule.keyword)) {
          if (rec.category !== rule.category || rec.subCategory !== rule.subCategory) {
            rec.category = rule.category;
            if (rule.subCategory) {
              rec.subCategory = rule.subCategory;
            } else {
              rec.subCategory = '';
            }
            changed = true;
          }
          break;
        }
      }
    });
    return changed;
  }

  function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeIcon(savedTheme);
  }

  function updateThemeIcon(theme) {
    const icon = document.getElementById('themeIcon');
    if (icon) {
      icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(THEME_KEY, next);
    updateThemeIcon(next);
    // Re-render charts with new theme font/grid colors
    updateCharts(getFilteredRecords(true));
  }

  // --- Filter Dropdowns Populate ---
  function populateFilterDropdowns() {
    const optgroupPhysical = document.getElementById('optgroupPhysical');
    const optgroupPay = document.getElementById('optgroupPay');
    const filterCategory = document.getElementById('filterCategory');
    const newActualCard = document.getElementById('newActualCard');
    const categoryDataList = document.getElementById('categoryDataList');

    if (!window.INITIAL_DATA) return;

    // Physical Cards
    if (optgroupPhysical) {
      optgroupPhysical.innerHTML = '';
      window.INITIAL_DATA.physicalCards.forEach(card => {
        const opt = document.createElement('option');
        opt.value = card;
        opt.textContent = card;
        optgroupPhysical.appendChild(opt);
      });
    }

    // Pay & Accounts
    if (optgroupPay) {
      optgroupPay.innerHTML = '';
      window.INITIAL_DATA.payAndAccounts.forEach(pay => {
        const opt = document.createElement('option');
        opt.value = pay;
        opt.textContent = pay;
        optgroupPay.appendChild(opt);
      });
    }

    // Modal Card options
    if (newActualCard) {
      newActualCard.innerHTML = '';
      window.INITIAL_DATA.allCards.forEach(card => {
        const opt = document.createElement('option');
        opt.value = card;
        opt.textContent = card;
        newActualCard.appendChild(opt);
      });
    }

    // Categories
    const categoriesSet = new Set();
    appState.records.forEach(r => {
      if (r.category) categoriesSet.add(r.category);
    });
    const sortedCats = Array.from(categoriesSet).sort();

    if (filterCategory) {
      filterCategory.innerHTML = '<option value="ALL">모든 카테고리</option>';
      sortedCats.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        filterCategory.appendChild(opt);
      });
    }

    populateCategorySelects();
  }

  function populateCategorySelects() {
    const mainCats = Object.keys(appState.masterCategories);
    
    // For Modals: newCategory, ruleCategory
    const newMain = document.getElementById('newCategory');
    const ruleMain = document.getElementById('ruleCategory');
    
    [newMain, ruleMain].forEach(selectEl => {
      if (!selectEl) return;
      const currentVal = selectEl.value;
      selectEl.innerHTML = '<option value="">대분류 선택</option>';
      mainCats.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        if (cat === currentVal) opt.selected = true;
        selectEl.appendChild(opt);
      });
      // trigger change to update subcategories
      selectEl.dispatchEvent(new Event('change'));
    });
  }

  function updateSubCategoryOptions(mainSelect, subSelectId) {
    const subSelect = document.getElementById(subSelectId);
    if (!subSelect) return;
    
    const mainCat = mainSelect.value;
    const currentVal = subSelect.value;
    
    subSelect.innerHTML = '<option value="">소분류 선택</option>';
    
    if (mainCat && appState.masterCategories[mainCat]) {
      appState.masterCategories[mainCat].forEach(sub => {
        const opt = document.createElement('option');
        opt.value = sub;
        opt.textContent = sub;
        if (sub === currentVal) opt.selected = true;
        subSelect.appendChild(opt);
      });
    }
  }

  // --- Filtering Logic ---
  // forDashboard = true means period filter applies, but search/table-specific filters don't restrict dashboard totals
  function getFilteredRecords(forDashboard = false) {
    return appState.records.filter(r => {
      if (forDashboard) {
        return true;
      }

      // Card Filter
      if (appState.filterCard === 'UNMAPPED') {
        const isPhysical = CARD_CONFIG[r.actualCard] && CARD_CONFIG[r.actualCard].type === 'physical';
        if (isPhysical) return false;
      } else if (appState.filterCard !== 'ALL') {
        if (r.actualCard !== appState.filterCard) return false;
      }

      // Category Filter
      if (appState.filterCategory !== 'ALL') {
        if (r.category !== appState.filterCategory) return false;
      }

      // Exclude Filter
      if (appState.filterExclude !== 'ALL') {
        if (r.exclude !== appState.filterExclude) return false;
      }

      // Installment Filter
      if (appState.filterInstallment === '일시불') {
        if (r.installment && r.installment !== '일시불') return false;
      } else if (appState.filterInstallment === '할부') {
        if (!r.installment || r.installment === '일시불') return false;
      }

      // Search Query (merchant, memo, origPay)
      if (appState.searchQuery.trim()) {
        const q = appState.searchQuery.trim().toLowerCase();
        const m = (r.merchant || '').toLowerCase();
        const memo = (r.memo || '').toLowerCase();
        const orig = (r.origPay || '').toLowerCase();
        const cat = (r.category || '').toLowerCase();
        const sub = (r.subCategory || '').toLowerCase();
        if (!m.includes(q) && !memo.includes(q) && !orig.includes(q) && !cat.includes(q) && !sub.includes(q)) {
          return false;
        }
      }

      return true;
    });
  }

  // --- Render All Dashboard Elements ---
  function renderAll() {
    identifyCanceledPairs(appState.records);
    renderKPIs();
    renderCardsBreakdown();
    updateCharts(getFilteredRecords(true));
    renderTable();
  }

  // --- Render KPIs ---
  function renderKPIs() {
    const records = getFilteredRecords(true);

    let totalValidAmt = 0;
    let totalValidCount = 0;
    let cardAmt = 0;
    let payAmt = 0;
    let payCount = 0;
    let billingAmt = 0;
    let installmentCount = 0;
    let excludedAmt = 0;
    let excludedCount = 0;

    records.forEach(r => {
      const amt = Number(r.amount) || 0;
      const bAmt = Number(r.billingAmount) || amt;
      const isExclude = r.exclude === 'Y';
      const isPhysical = CARD_CONFIG[r.actualCard] && CARD_CONFIG[r.actualCard].type === 'physical';
      const isPayOrAccount = !isPhysical;

      if (isExclude) {
        excludedAmt += amt;
        excludedCount++;
      } else {
        totalValidAmt += amt;
        totalValidCount++;

        if (isPhysical) {
          cardAmt += amt;
        } else {
          payAmt += amt;
          payCount++;
        }

        billingAmt += bAmt;

        if (r.installment && r.installment !== '일시불') {
          installmentCount++;
        }
      }
    });

    // Update KPI Elements
    document.getElementById('kpiTotalAmount').textContent = formatCurrency(totalValidAmt);
    document.getElementById('kpiTxCount').textContent = `${totalValidCount}건 지출 반영`;

    // Daily average based on period (10 days)
    const daysInPeriod = 10;
    const dailyAvg = Math.round(totalValidAmt / daysInPeriod);
    document.getElementById('kpiDailyAvg').textContent = `일평균 ${formatCurrency(dailyAvg)}원`;

    // Card Amount & Ratio
    document.getElementById('kpiCardAmount').textContent = formatCurrency(cardAmt);
    const cardRatio = totalValidAmt > 0 ? Math.round((cardAmt / totalValidAmt) * 100) : 0;
    document.getElementById('kpiCardRatioBar').style.width = `${cardRatio}%`;
    document.getElementById('kpiCardRatioText').textContent = `지출 비중 ${cardRatio}%`;

    // Pay Amount
    document.getElementById('kpiPayAmount').textContent = formatCurrency(payAmt);
    document.getElementById('kpiPayCount').textContent = `간편결제/계좌 ${payCount}건`;

    // Billing Amount
    document.getElementById('kpiBillingAmount').textContent = formatCurrency(billingAmt);
    document.getElementById('kpiInstallmentCount').textContent = `할부 설정 ${installmentCount}건`;

    // Excluded
    document.getElementById('kpiExcludedAmount').textContent = formatCurrency(excludedAmt);
    document.getElementById('kpiExcludedCount').textContent = `${excludedCount}건 제외 중`;

    // Subtotals in Panel
    document.getElementById('cardSubtotalBadge').textContent = `카드 합계: ${formatCurrency(cardAmt)}원`;
    document.getElementById('paySubtotalBadge').textContent = `소계: ${formatCurrency(payAmt)}원`;

    // Period info
    const countInfo = document.getElementById('periodTxCount');
    if (countInfo) {
      countInfo.textContent = `총 ${records.length}건의 지출 내역 (포함 ${totalValidCount}건)`;
    }

    // Mapping Notice Banner Update & UNMAPPED select option text
    const banner = document.getElementById('mappingNoticeBanner');
    const bannerText = document.getElementById('unmappedBannerText');
    const optUnmapped = document.getElementById('optUnmappedAll');
    if (optUnmapped) {
      optUnmapped.textContent = `⚡ 간편결제/계좌 전체 (미매핑 ${payCount}건)`;
    }

    if (payCount > 0) {
      banner.style.display = 'flex';
      bannerText.textContent = `아직 카드가 지정되지 않은 간편결제/계좌 내역이 ${payCount}건 (${formatCurrency(payAmt)}원) 남아있습니다. '매핑하기'를 누르면 해당 내역만 모아서 편리하게 카드를 지정하실 수 있습니다!`;
    } else {
      banner.style.display = 'none';
    }
  }

  // --- Render Card Performance Breakdown ---
  function renderCardsBreakdown() {
    const records = getFilteredRecords(true);
    const physicalCardsContainer = document.getElementById('physicalCardsContainer');
    const payAccountsContainer = document.getElementById('payAccountsContainer');

    if (!physicalCardsContainer || !payAccountsContainer) return;

    // Aggregate by card
    const cardSums = {};
    const cardCounts = {};
    let totalPhysicalAmt = 0;

    records.forEach(r => {
      if (r.exclude === 'Y') return;
      const card = r.actualCard || '기타 카드';
      const amt = Number(r.amount) || 0;
      cardSums[card] = (cardSums[card] || 0) + amt;
      cardCounts[card] = (cardCounts[card] || 0) + 1;

      if (CARD_CONFIG[card] && CARD_CONFIG[card].type === 'physical') {
        totalPhysicalAmt += amt;
      }
    });

    // Render Physical Cards
    physicalCardsContainer.innerHTML = '';
    const physicalCardNames = window.INITIAL_DATA.physicalCards;

    physicalCardNames.forEach(cardName => {
      const conf = CARD_CONFIG[cardName] || { color: '#64748b', chip: '#475569', target: 300000 };
      const amt = cardSums[cardName] || 0;
      const cnt = cardCounts[cardName] || 0;
      const share = totalPhysicalAmt > 0 ? ((amt / totalPhysicalAmt) * 100).toFixed(1) : 0;
      const targetPercent = conf.target > 0 ? Math.min(100, Math.round((amt / conf.target) * 100)) : 100;
      const isTargetMet = conf.target > 0 && amt >= conf.target;

      const cardEl = document.createElement('div');
      cardEl.className = `card-item ${appState.filterCard === cardName ? 'active-filter' : ''}`;
      cardEl.title = `${cardName} 내역 필터링`;
      cardEl.innerHTML = `
        <div class="card-item-top">
          <div class="card-brand-name">
            <span class="card-brand-chip" style="background: ${conf.color};"></span>
            <span class="card-title">${cardName}</span>
          </div>
          <div class="card-amount-group">
            <span class="card-amount">${formatCurrency(amt)}원</span>
            <span class="card-share">(${share}%)</span>
          </div>
        </div>
        <div class="card-item-bottom">
          <div class="card-bar-bg">
            <div class="card-bar-fill" style="width: ${share}%; background: ${conf.color};"></div>
          </div>
          <span class="card-meta-text">
            ${cnt}건 ${conf.target > 0 ? `· 목표 ${formatCurrency(conf.target)}원 (${targetPercent}% ${isTargetMet ? '달성✨' : ''})` : ''}
          </span>
        </div>
      `;

      cardEl.addEventListener('click', () => {
        if (appState.filterCard === cardName) {
          appState.filterCard = 'ALL';
        } else {
          appState.filterCard = cardName;
        }
        document.getElementById('filterCard').value = appState.filterCard;
        appState.currentPage = 1;
        renderCardsBreakdown();
        renderTable();
        showToast(`'${cardName}' 내역 필터가 적용되었습니다.`);
      });

      physicalCardsContainer.appendChild(cardEl);
    });

    // Render Pay & Accounts mini-cards
    payAccountsContainer.innerHTML = '';
    const payNames = window.INITIAL_DATA.payAndAccounts;

    payNames.forEach(payName => {
      const conf = CARD_CONFIG[payName] || { color: '#64748b', dot: '#94a3b8' };
      const amt = cardSums[payName] || 0;
      const cnt = cardCounts[payName] || 0;

      const payEl = document.createElement('div');
      payEl.className = `pay-mini-card ${appState.filterCard === payName ? 'active-filter' : ''}`;
      payEl.innerHTML = `
        <div class="pay-mini-title">
          <span class="pay-mini-dot" style="background: ${conf.dot || conf.color};"></span>
          <span>${payName.replace('[간편결제] ', '')}</span>
        </div>
        <div class="pay-mini-amount">${formatCurrency(amt)}원 <small style="font-weight:400; font-size:0.75rem; color:var(--text-muted);">(${cnt}건)</small></div>
      `;

      payEl.addEventListener('click', () => {
        if (appState.filterCard === payName) {
          appState.filterCard = 'ALL';
        } else {
          appState.filterCard = payName;
        }
        document.getElementById('filterCard').value = appState.filterCard;
        appState.currentPage = 1;
        renderCardsBreakdown();
        renderTable();
      });

      payAccountsContainer.appendChild(payEl);
    });
  }

  // --- Charts Logic ---
  function updateCharts(records) {
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const textColor = isDark ? '#94a3b8' : '#475569';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)';

    // 1. Doughnut: Card Breakdown
    renderCardDoughnut(records, textColor);

    // 2. Bar: Category Breakdown
    renderCategoryBar(records, textColor, gridColor);

    // 3. Line: Daily Spend Trend
    renderTrendLine(records, textColor, gridColor);

    // 4. Bar: Daily Spend Breakdown (Sep 1 to Sep 10)
    renderDailyBar(textColor, gridColor);
  }

  function renderCardDoughnut(records, textColor) {
    const canvas = document.getElementById('cardDoughnutChart');
    const legendBox = document.getElementById('cardCustomLegend');
    if (!canvas) return;

    const sums = {};
    records.forEach(r => {
      if (r.exclude === 'Y') return;
      const card = r.actualCard || '기타 카드';
      sums[card] = (sums[card] || 0) + (Number(r.amount) || 0);
    });

    const sortedCards = Object.keys(sums).sort((a, b) => sums[b] - sums[a]);
    const labels = sortedCards;
    const data = sortedCards.map(c => sums[c]);
    const bgColors = sortedCards.map(c => (CARD_CONFIG[c] ? CARD_CONFIG[c].color : '#64748b'));

    if (charts.doughnut) {
      charts.doughnut.destroy();
    }

    charts.doughnut = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: bgColors,
          borderWidth: 2,
          borderColor: document.documentElement.getAttribute('data-theme') === 'light' ? '#ffffff' : '#111827',
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                const val = ctx.parsed;
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const percent = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${formatCurrency(val)}원 (${percent}%)`;
              }
            }
          }
        }
      }
    });

    // Custom Legend
    if (legendBox) {
      legendBox.innerHTML = '';
      labels.forEach((lbl, idx) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
          <span class="legend-color-dot" style="background: ${bgColors[idx]};"></span>
          <span>${lbl.replace('[간편결제] ', '')} (${formatCurrency(data[idx])}원)</span>
        `;
        legendBox.appendChild(item);
      });
    }
  }

  function renderCategoryBar(records, textColor, gridColor) {
    const canvas = document.getElementById('categoryBarChart');
    if (!canvas) return;

    const catSums = {};
    records.forEach(r => {
      if (r.exclude === 'Y') return;
      const cat = r.category || '기타';
      catSums[cat] = (catSums[cat] || 0) + (Number(r.amount) || 0);
    });

    const sortedCats = Object.keys(catSums).sort((a, b) => catSums[b] - catSums[a]).slice(0, 10);
    const labels = sortedCats;
    const data = sortedCats.map(c => catSums[c]);

    if (charts.categoryBar) {
      charts.categoryBar.destroy();
    }

    charts.categoryBar = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: '지출 금액',
          data: data,
          backgroundColor: CATEGORY_COLORS.slice(0, labels.length),
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        scales: {
          x: {
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              callback: val => formatCurrency(val) + '원'
            }
          },
          y: {
            grid: { display: false },
            ticks: { color: textColor, font: { weight: '600' } }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.x)}원`
            }
          }
        }
      }
    });
  }

  function renderTrendLine(records, textColor, gridColor) {
    const canvas = document.getElementById('trendLineChart');
    if (!canvas) return;

    // Daily cumulative spending
    const dailyMap = {};
    records.forEach(r => {
      if (r.exclude === 'Y' || !r.date) return;
      const d = r.date;
      dailyMap[d] = (dailyMap[d] || 0) + (Number(r.amount) || 0);
    });

    const sortedDates = Object.keys(dailyMap).sort();
    let cumulative = 0;
    const cumData = sortedDates.map(d => {
      cumulative += dailyMap[d];
      return cumulative;
    });

    if (charts.trendLine) {
      charts.trendLine.destroy();
    }

    charts.trendLine = new Chart(canvas, {
      type: 'line',
      data: {
        labels: sortedDates.map(d => d.slice(5)), // MM-DD
        datasets: [
          {
            label: '일별 지출액',
            type: 'bar',
            data: sortedDates.map(d => dailyMap[d]),
            backgroundColor: 'rgba(99, 102, 241, 0.35)',
            borderRadius: 4,
            yAxisID: 'y'
          },
          {
            label: '누적 지출액',
            type: 'line',
            data: cumData,
            borderColor: '#06b6d4',
            backgroundColor: 'rgba(6, 182, 212, 0.1)',
            fill: true,
            tension: 0.3,
            borderWidth: 3,
            pointRadius: 3,
            pointHoverRadius: 6,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: textColor, maxTicksLimit: 14 }
          },
          y: {
            position: 'left',
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              callback: val => formatCurrency(val)
            }
          },
          y1: {
            position: 'right',
            grid: { display: false },
            ticks: {
              color: '#06b6d4',
              callback: val => formatCurrency(val)
            }
          }
        },
        plugins: {
          legend: { labels: { color: textColor } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}원`
            }
          }
        }
      }
    });
  }

  function renderDailyBar(textColor, gridColor) {
    const canvas = document.getElementById('dailyBarChart');
    if (!canvas) return;

    const dates = [
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05',
      '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10'
    ];
    const cardData = dates.map(() => 0);
    const payData = dates.map(() => 0);

    appState.records.forEach(r => {
      if (r.exclude === 'Y' || !r.date) return;
      const idx = dates.indexOf(r.date);
      if (idx !== -1) {
        const amt = Number(r.amount) || 0;
        const isPhysical = CARD_CONFIG[r.actualCard] && CARD_CONFIG[r.actualCard].type === 'physical';
        if (isPhysical) cardData[idx] += amt;
        else payData[idx] += amt;
      }
    });

    if (charts.dailyBar) {
      charts.dailyBar.destroy();
    }

    charts.dailyBar = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: dates.map(d => `${parseInt(d.slice(8), 10)}일`),
        datasets: [
          {
            label: '실물 카드 지출',
            data: cardData,
            backgroundColor: '#2563eb',
            borderRadius: 4
          },
          {
            label: '간편결제/계좌 지출',
            data: payData,
            backgroundColor: '#f59e0b',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: textColor }
          },
          y: {
            stacked: true,
            grid: { color: gridColor },
            ticks: {
              color: textColor,
              callback: val => formatCurrency(val) + '원'
            }
          }
        },
        plugins: {
          legend: { labels: { color: textColor } },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${formatCurrency(ctx.parsed.y)}원`
            }
          }
        }
      }
    });
  }

  // --- Render Transactions Table ---
  function renderTable() {
    const tableBody = document.getElementById('txTableBody');
    if (!tableBody) return;

    const filtered = getFilteredRecords(false);

    // Sorting
    filtered.sort((a, b) => {
      let valA = a[appState.sortBy];
      let valB = b[appState.sortBy];

      if (appState.sortBy === 'amount' || appState.sortBy === 'id' || appState.sortBy === 'billingAmount') {
        valA = Number(valA) || 0;
        valB = Number(valB) || 0;
      } else {
        valA = (valA || '').toString();
        valB = (valB || '').toString();
      }

      if (valA < valB) return appState.sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return appState.sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    // Update stats summary in header
    const totalFilteredAmt = filtered.filter(r => r.exclude !== 'Y').reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    document.getElementById('filteredCountBadge').textContent = `검색/필터 결과: ${filtered.length}건`;
    document.getElementById('filteredSumBadge').textContent = `합계: ${formatCurrency(totalFilteredAmt)}원`;

    // Pagination
    const pageSize = appState.pageSize;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (appState.currentPage > totalPages) appState.currentPage = totalPages;

    const startIndex = (appState.currentPage - 1) * pageSize;
    const pageRecords = filtered.slice(startIndex, startIndex + pageSize);

    tableBody.innerHTML = '';

    if (pageRecords.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="12" style="text-align:center; padding: 48px 16px; color: var(--text-muted);">
            <div style="font-size: 2rem; margin-bottom: 8px;">🔍</div>
            <p>검색 및 필터 조건에 부합하는 지출 내역이 없습니다.</p>
          </td>
        </tr>
      `;
      renderPagination(totalPages);
      return;
    }

    // Build Table Rows
    const allCards = window.INITIAL_DATA ? window.INITIAL_DATA.allCards : [];
    const installmentOptions = ['일시불', '2개월', '3개월', '4개월', '5개월', '6개월', '12개월'];

    pageRecords.forEach(rec => {
      const isExcluded = rec.exclude === 'Y';
      const isUnmapped = !CARD_CONFIG[rec.actualCard] || CARD_CONFIG[rec.actualCard].type !== 'physical';
      const isCanceledClass = rec.isCanceled ? 'is-canceled' : '';

      const tr = document.createElement('tr');
      tr.className = `${isExcluded ? 'tx-row-excluded' : ''} ${isCanceledClass}`.trim();
      tr.dataset.id = rec.id;

      // Card Select Options
      let cardOptionsHtml = '';
      allCards.forEach(card => {
        const isSelected = card === rec.actualCard;
        cardOptionsHtml += `<option value="${card}" ${isSelected ? 'selected' : ''}>${card}</option>`;
      });

      // Installment Options
      let instOptionsHtml = '';
      installmentOptions.forEach(inst => {
        const isSelected = inst === (rec.installment || '일시불');
        instOptionsHtml += `<option value="${inst}" ${isSelected ? 'selected' : ''}>${inst}</option>`;
      });

      // Category Options for Table Select
      const mainCats = Object.keys(appState.masterCategories);
      let catOptionsHtml = '<option value="">대분류</option>';
      let isValidCat = false;
      mainCats.forEach(cat => {
        const isSelected = cat === rec.category;
        if (isSelected) isValidCat = true;
        catOptionsHtml += `<option value="${cat}" ${isSelected ? 'selected' : ''}>${cat}</option>`;
      });
      if (rec.category && !isValidCat) {
        catOptionsHtml += `<option value="${rec.category}" selected>${rec.category} (미등록)</option>`;
      }

      // SubCategory Options for Table Select
      let subOptionsHtml = '<option value="">소분류</option>';
      let isValidSub = false;
      const validSubCats = appState.masterCategories[rec.category] || [];
      validSubCats.forEach(sub => {
        const isSelected = sub === rec.subCategory;
        if (isSelected) isValidSub = true;
        subOptionsHtml += `<option value="${sub}" ${isSelected ? 'selected' : ''}>${sub}</option>`;
      });
      if (rec.subCategory && !isValidSub) {
        subOptionsHtml += `<option value="${rec.subCategory}" selected>${rec.subCategory} (미등록)</option>`;
      }

      tr.innerHTML = `
        <td class="col-id">${rec.id}</td>
        <td class="col-date">
          <div>${rec.date}</div>
          <small style="color:var(--text-muted); font-size:0.75rem;">${rec.time || ''}</small>
        </td>
        <td class="col-cat">
          <select class="input-table-category badge-cat-input" data-id="${rec.id}" title="대분류 선택">
            ${catOptionsHtml}
          </select>
          <select class="input-table-subcategory" data-id="${rec.id}" title="소분류 선택">
            ${subOptionsHtml}
          </select>
        </td>
        <td class="col-merchant" title="${rec.merchant}">
          ${rec.merchant}
        </td>
        <td class="col-amt">${formatCurrency(rec.amount)}</td>
        <td class="col-orig" title="${rec.origPay}">${rec.origPay}</td>
        <td class="col-actual">
          <select class="select-table-card ${isUnmapped ? 'highlight-unmapped' : ''}" data-field="actualCard" data-id="${rec.id}">
            ${cardOptionsHtml}
          </select>
        </td>
        <td class="col-inst">
          <select class="select-table-inst" data-field="installment" data-id="${rec.id}">
            ${instOptionsHtml}
          </select>
        </td>
        <td class="col-bill" id="billCell_${rec.id}">
          ${formatCurrency(rec.billingAmount || rec.amount)}
        </td>
        <td class="col-exclude">
          <button class="exclude-toggle-btn ${isExcluded ? 'active-y' : ''}" data-id="${rec.id}" title="클릭하여 집계 제외/포함 토글">
            ${rec.exclude}
          </button>
        </td>
        <td class="col-memo">
          <input type="text" class="input-table-memo" data-id="${rec.id}" value="${rec.memo || ''}" placeholder="메모 입력...">
        </td>
        <td class="col-action">
          <button class="btn-delete-row" data-id="${rec.id}" title="내역 삭제">🗑️</button>
        </td>
      `;

      tableBody.appendChild(tr);
    });

    renderPagination(totalPages);
  }

  // --- Pagination Controls ---
  function renderPagination(totalPages) {
    const container = document.getElementById('paginationControls');
    if (!container) return;
    container.innerHTML = '';

    if (totalPages <= 1) return;

    // Previous Button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.innerHTML = '&lsaquo;';
    prevBtn.disabled = appState.currentPage === 1;
    prevBtn.addEventListener('click', () => {
      if (appState.currentPage > 1) {
        appState.currentPage--;
        renderTable();
      }
    });
    container.appendChild(prevBtn);

    // Page numbers (max 7 shown)
    let startPage = Math.max(1, appState.currentPage - 3);
    let endPage = Math.min(totalPages, startPage + 6);
    if (endPage - startPage < 6) {
      startPage = Math.max(1, endPage - 6);
    }

    for (let p = startPage; p <= endPage; p++) {
      const pageBtn = document.createElement('button');
      pageBtn.className = `page-btn ${p === appState.currentPage ? 'active' : ''}`;
      pageBtn.textContent = p;
      pageBtn.addEventListener('click', () => {
        appState.currentPage = p;
        renderTable();
      });
      container.appendChild(pageBtn);
    }

    // Next Button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.innerHTML = '&rsaquo;';
    nextBtn.disabled = appState.currentPage === totalPages;
    nextBtn.addEventListener('click', () => {
      if (appState.currentPage < totalPages) {
        appState.currentPage++;
        renderTable();
      }
    });
    container.appendChild(nextBtn);
  }

  // --- Table Event Delegation (Real-time updates) ---
  // --- Table Event Delegation (Real-time updates) ---
  function handleTableChange(e) {
    const target = e.target;

    // 1. Change Actual Card
    if (target.matches('.select-table-card')) {
      const id = Number(target.dataset.id);
      const newCard = target.value;
      const rec = appState.records.find(r => r.id === id);
      if (rec) {
        rec.actualCard = newCard;
        saveData();
        renderKPIs();
        renderCardsBreakdown();
        updateCharts(getFilteredRecords(true));

        // Remove or add unmapped highlight class
        const isUnmapped = !CARD_CONFIG[newCard] || CARD_CONFIG[newCard].type !== 'physical';
        target.classList.toggle('highlight-unmapped', isUnmapped);

        showToast(`[#${id}] '${rec.merchant}' 카드가 '${newCard}'(으)로 변경되었습니다!`, 'success');
      }
    }

    // 2. Change Installment Months
    if (target.matches('.select-table-inst')) {
      const id = Number(target.dataset.id);
      const instVal = target.value;
      const rec = appState.records.find(r => r.id === id);
      if (rec) {
        rec.installment = instVal;
        const months = parseInt(instVal, 10);
        if (!isNaN(months) && months > 1) {
          rec.billingAmount = Math.round(rec.amount / months);
        } else {
          rec.billingAmount = rec.amount;
        }
        saveData();
        renderKPIs();
        const billCell = document.getElementById(`billCell_${id}`);
        if (billCell) billCell.textContent = formatCurrency(rec.billingAmount);
        showToast(`[#${id}] 할부가 '${instVal}'(청구액 ${formatCurrency(rec.billingAmount)}원)로 설정되었습니다.`);
      }
    }
  }

  function handleTableClick(e) {
    const target = e.target;

    // 1. Toggle Exclude (Y / N)
    if (target.closest('.exclude-toggle-btn')) {
      const btn = target.closest('.exclude-toggle-btn');
      const id = Number(btn.dataset.id);
      const rec = appState.records.find(r => r.id === id);
      if (rec) {
        rec.exclude = rec.exclude === 'Y' ? 'N' : 'Y';
        saveData();
        renderKPIs();
        renderCardsBreakdown();
        updateCharts(getFilteredRecords(true));
        renderTable();
        showToast(
          rec.exclude === 'Y'
            ? `[#${id}] 항목이 통계 및 지출에서 제외(Y) 처리되었습니다.`
            : `[#${id}] 항목이 다시 통계에 포함(N)되었습니다.`,
          rec.exclude === 'Y' ? 'warn' : 'info'
        );
      }
    }

    // 2. Delete Row
    if (target.closest('.btn-delete-row')) {
      const id = Number(target.closest('.btn-delete-row').dataset.id);
      if (confirm(`No. ${id} 지출 내역을 완전히 삭제하시겠습니까?`)) {
        const rec = appState.records.find(r => r.id === id);
        if (rec) {
          appState.deletedSignatures.add(getSignature(rec));
          localStorage.setItem(DELETED_RECORDS_KEY, JSON.stringify(Array.from(appState.deletedSignatures)));
        }
        appState.records = appState.records.filter(r => r.id !== id);
        saveData();
        renderAll();
        showToast(`No. ${id} 내역이 삭제되었습니다.`);
      }
    }
  }

  // --- Attach Event Listeners ---
  function attachEventListeners() {
    // Theme Toggle
    document.getElementById('btnThemeToggle')?.addEventListener('click', toggleTheme);


    // Chart Tabs
    document.querySelectorAll('.chart-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.chart-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.chartTab;
        appState.activeChartTab = tab;

        document.querySelectorAll('.chart-view').forEach(v => v.classList.remove('active'));
        if (tab === 'cards') document.getElementById('chartViewCards')?.classList.add('active');
        else if (tab === 'categories') document.getElementById('chartViewCategories')?.classList.add('active');
        else if (tab === 'trends') document.getElementById('chartViewTrends')?.classList.add('active');
        else if (tab === 'daily') document.getElementById('chartViewDaily')?.classList.add('active');
      });
    });

    // Quick Banner / KPI Filter buttons
    document.getElementById('btnBannerFilter')?.addEventListener('click', () => {
      appState.filterCard = 'UNMAPPED';
      document.getElementById('filterCard').value = 'UNMAPPED';
      appState.currentPage = 1;
      renderCardsBreakdown();
      renderTable();
      const unmappedCount = appState.records.filter(r => r.exclude !== 'Y' && (!CARD_CONFIG[r.actualCard] || CARD_CONFIG[r.actualCard].type !== 'physical')).length;
      showToast(`미매핑된 간편결제/계좌 내역 ${unmappedCount}건을 표시합니다.`, 'info');
    });

    document.getElementById('btnFilterUnmapped')?.addEventListener('click', () => {
      appState.filterCard = 'UNMAPPED';
      document.getElementById('filterCard').value = 'UNMAPPED';
      appState.currentPage = 1;
      renderCardsBreakdown();
      renderTable();
      const unmappedCount = appState.records.filter(r => r.exclude !== 'Y' && (!CARD_CONFIG[r.actualCard] || CARD_CONFIG[r.actualCard].type !== 'physical')).length;
      showToast(`미매핑된 간편결제/계좌 내역 ${unmappedCount}건을 표시합니다.`, 'info');
    });

    document.getElementById('btnFilterExcluded')?.addEventListener('click', () => {
      appState.filterExclude = 'Y';
      document.getElementById('filterExclude').value = 'Y';
      appState.currentPage = 1;
      renderTable();
      showToast('제외(Y)된 항목만 표시합니다.');
    });

    // Search Input
    const searchInput = document.getElementById('searchInput');
    const btnClearSearch = document.getElementById('btnClearSearch');
    if (searchInput) {
      let debounceTimer = null;
      searchInput.addEventListener('input', e => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          appState.searchQuery = e.target.value;
          appState.currentPage = 1;
          if (btnClearSearch) btnClearSearch.style.display = appState.searchQuery ? 'block' : 'none';
          renderTable();
        }, 200);
      });
    }

    if (btnClearSearch) {
      btnClearSearch.addEventListener('click', () => {
        searchInput.value = '';
        appState.searchQuery = '';
        btnClearSearch.style.display = 'none';
        appState.currentPage = 1;
        renderTable();
      });
    }

    // Dropdown Filters
    document.getElementById('filterCard')?.addEventListener('change', e => {
      appState.filterCard = e.target.value;
      appState.currentPage = 1;
      renderCardsBreakdown();
      renderTable();
    });

    document.getElementById('filterCategory')?.addEventListener('change', e => {
      appState.filterCategory = e.target.value;
      appState.currentPage = 1;
      renderTable();
    });

    document.getElementById('filterExclude')?.addEventListener('change', e => {
      appState.filterExclude = e.target.value;
      appState.currentPage = 1;
      renderTable();
    });

    document.getElementById('filterInstallment')?.addEventListener('change', e => {
      appState.filterInstallment = e.target.value;
      appState.currentPage = 1;
      renderTable();
    });

    // Reset Filters Button
    document.getElementById('btnResetFilters')?.addEventListener('click', () => {
      appState.searchQuery = '';
      appState.filterCard = 'ALL';
      appState.filterCategory = 'ALL';
      appState.filterExclude = 'ALL';
      appState.filterInstallment = 'ALL';
      if (searchInput) searchInput.value = '';
      if (btnClearSearch) btnClearSearch.style.display = 'none';
      document.getElementById('filterCard').value = 'ALL';
      document.getElementById('filterCategory').value = 'ALL';
      document.getElementById('filterExclude').value = 'ALL';
      document.getElementById('filterInstallment').value = 'ALL';
      appState.currentPage = 1;
      renderCardsBreakdown();
      renderTable();
      showToast('모든 필터가 초기화되었습니다.');
    });

    // Table Header Sorting
    document.querySelectorAll('.tx-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const sortField = th.dataset.sort;
        if (appState.sortBy === sortField) {
          appState.sortOrder = appState.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
          appState.sortBy = sortField;
          appState.sortOrder = 'asc';
        }

        document.querySelectorAll('.tx-table th .sort-indicator').forEach(si => (si.textContent = '↕'));
        const indicator = th.querySelector('.sort-indicator');
        if (indicator) indicator.textContent = appState.sortOrder === 'asc' ? '↑' : '↓';

        renderTable();
      });
    });

    // Table Interactions (delegation)
    const tableBody = document.getElementById('txTableBody');
    tableBody?.addEventListener('change', handleTableChange);
    tableBody?.addEventListener('click', handleTableClick);

    // Table Inline Edit (Category, SubCategory)
    tableBody?.addEventListener('change', e => {
      if (e.target.matches('.input-table-category') || e.target.matches('.input-table-subcategory')) {
        const id = Number(e.target.dataset.id);
        const rec = appState.records.find(r => r.id === id);
        if (rec) {
          if (e.target.matches('.input-table-category')) {
            rec.category = e.target.value || '기타';
            // if main category changes, reset subcategory
            rec.subCategory = '';
            
            // update subcategory dropdown for this specific row
            const subSelect = e.target.closest('td').querySelector('.input-table-subcategory');
            if (subSelect) {
              subSelect.innerHTML = '<option value="">소분류 선택</option>';
              const subCats = appState.masterCategories[rec.category] || [];
              subCats.forEach(sub => {
                const opt = document.createElement('option');
                opt.value = sub;
                opt.textContent = sub;
                subSelect.appendChild(opt);
              });
            }
          } else {
            rec.subCategory = e.target.value;
          }
          saveData();
          populateFilterDropdowns();
          renderKPIs();
          updateCharts(getFilteredRecords(true));
          showToast(`[#${id}] 카테고리가 변경되었습니다.`);
        }
      }
    });

    // Table Memo Inline Edit
    tableBody?.addEventListener('blur', e => {
      if (e.target.matches('.input-table-memo')) {
        const id = Number(e.target.dataset.id);
        const val = e.target.value;
        const rec = appState.records.find(r => r.id === id);
        if (rec && rec.memo !== val) {
          rec.memo = val;
          saveData();
        }
      }
    }, true);

    // Page Size Select
    document.getElementById('pageSizeSelect')?.addEventListener('change', e => {
      appState.pageSize = Number(e.target.value);
      appState.currentPage = 1;
      renderTable();
    });

    // Modal: New Transaction
    const modal = document.getElementById('newTxModal');
    document.getElementById('btnNewTransaction')?.addEventListener('click', () => {
      const today = new Date().toISOString().slice(0, 10);
      document.getElementById('newDate').value = today;
      modal.classList.add('show');
    });

    document.getElementById('btnCloseModal')?.addEventListener('click', () => modal.classList.remove('show'));
    document.getElementById('btnCancelModal')?.addEventListener('click', () => modal.classList.remove('show'));

    document.getElementById('newTxForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const date = document.getElementById('newDate').value;
      const time = document.getElementById('newTime').value;
      const category = document.getElementById('newCategory').value;
      const subCategory = document.getElementById('newSubCategory').value;
      const merchant = document.getElementById('newMerchant').value;
      const amount = Number(document.getElementById('newAmount').value) || 0;
      const origPay = document.getElementById('newOrigPay').value || '기타';
      const actualCard = document.getElementById('newActualCard').value;
      const installment = document.getElementById('newInstallment').value;
      const memo = document.getElementById('newMemo').value;

      const nextId = appState.records.length > 0 ? Math.max(...appState.records.map(r => r.id)) + 1 : 1;
      const monthNum = parseInt(date.split('-')[1], 10);
      const monthStr = `${monthNum}월`;

      let billingAmount = amount;
      const instMonths = parseInt(installment, 10);
      if (!isNaN(instMonths) && instMonths > 1) {
        billingAmount = Math.round(amount / instMonths);
      }

      const newRecord = {
        id: nextId,
        date: date,
        time: time,
        month: monthStr,
        category: category,
        subCategory: subCategory,
        merchant: merchant,
        amount: amount,
        origPay: origPay,
        actualCard: actualCard,
        installment: installment,
        billingAmount: billingAmount,
        exclude: 'N',
        memo: memo
      };

      applyCategoryRules([newRecord]);
      appState.records.unshift(newRecord);
      saveData();
      modal.classList.remove('show');
      e.target.reset();

      // Refresh filters if new category added
      populateFilterDropdowns();
      renderAll();

      if (typeof confetti === 'function') {
        confetti({ particleCount: 60, spread: 60, origin: { y: 0.7 } });
      }

      showToast(`새 지출 [${merchant} - ${formatCurrency(amount)}원]이 성공적으로 등록되었습니다!`, 'success');
    });

    // Reset Data to Initial
    document.getElementById('btnResetData')?.addEventListener('click', () => {
      if (confirm('모든 수정사항을 취소하고 원본 엑셀 데이터(261건)로 초기화하시겠습니까? (삭제된 내역 기록도 초기화됩니다)')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(DELETED_RECORDS_KEY);
        appState.deletedSignatures.clear();
        if (window.INITIAL_DATA) {
          appState.records = JSON.parse(JSON.stringify(window.INITIAL_DATA.records));
          saveData();
        }
        renderAll();
        showToast('원본 엑셀 데이터 및 삭제 기록이 초기화되었습니다.', 'info');
      }
    });

    // Export to Excel
    document.getElementById('btnExportExcel')?.addEventListener('click', exportToExcel);

    // Category Rules Modal
    const rulesModal = document.getElementById('categoryRulesModal');
    
    document.getElementById('btnCategoryRules')?.addEventListener('click', () => {
      renderRulesTable();
      rulesModal.classList.add('show');
    });

    document.getElementById('btnCloseRulesModal')?.addEventListener('click', () => rulesModal.classList.remove('show'));
    document.getElementById('btnDoneRulesModal')?.addEventListener('click', () => rulesModal.classList.remove('show'));

    document.getElementById('newRuleForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const keyword = document.getElementById('ruleKeyword').value.trim();
      const category = document.getElementById('ruleCategory').value.trim();
      const subCategory = document.getElementById('ruleSubCategory').value.trim();
      
      if (!keyword || !category) return;
      
      appState.categoryRules.push({ id: Date.now(), keyword, category, subCategory });
      saveRules();
      renderRulesTable();
      e.target.reset();
      showToast(`'${keyword}' 규칙이 추가되었습니다.`, 'success');
    });

    document.getElementById('rulesTableBody')?.addEventListener('click', e => {
      if (e.target.closest('.btn-delete-rule')) {
        const id = Number(e.target.closest('.btn-delete-rule').dataset.id);
        appState.categoryRules = appState.categoryRules.filter(r => r.id !== id);
        saveRules();
        renderRulesTable();
        showToast('규칙이 삭제되었습니다.');
      }
    });

    document.getElementById('btnApplyRulesNow')?.addEventListener('click', () => {
      const changed = applyCategoryRules(appState.records);
      if (changed) {
        saveData();
        populateFilterDropdowns();
        renderAll();
        showToast('현재 등록된 규칙을 모든 지출 내역에 적용했습니다!', 'success');
      } else {
        showToast('적용할 변경 사항이 없습니다.', 'info');
      }
    });

    function renderRulesTable() {
      const tbody = document.getElementById('rulesTableBody');
      if (!tbody) return;
      tbody.innerHTML = '';
      if (appState.categoryRules.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--text-muted);">등록된 규칙이 없습니다.</td></tr>';
        return;
      }
      appState.categoryRules.forEach(rule => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td style="padding: 10px;">${rule.keyword}</td>
          <td style="padding: 10px;"><span class="badge-cat">${rule.category}</span></td>
          <td style="padding: 10px;">${rule.subCategory || '-'}</td>
          <td style="padding: 10px; text-align: center;">
            <button type="button" class="btn-delete-rule" data-id="${rule.id}" title="삭제" style="background:none; border:none; cursor:pointer; font-size:1.2rem; color:var(--text-muted);">🗑️</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    }

    // Category cascading for Modals
    document.getElementById('newCategory')?.addEventListener('change', function() {
      updateSubCategoryOptions(this, 'newSubCategory');
    });
    
    document.getElementById('ruleCategory')?.addEventListener('change', function() {
      updateSubCategoryOptions(this, 'ruleSubCategory');
    });

    // Category Manage Modal
    const manageModal = document.getElementById('categoryManageModal');
    
    document.getElementById('btnManageCategories')?.addEventListener('click', () => {
      appState.activeManageMainCat = null;
      renderManageMainCategories();
      renderManageSubCategories();
      manageModal.classList.add('show');
    });

    document.getElementById('btnCloseCategoryManageModal')?.addEventListener('click', () => manageModal.classList.remove('show'));
    document.getElementById('btnDoneCategoryManageModal')?.addEventListener('click', () => manageModal.classList.remove('show'));

    document.getElementById('newMainCategoryForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const val = document.getElementById('newMainCategoryName').value.trim();
      if (!val || appState.masterCategories[val]) {
        showToast('이미 존재하거나 잘못된 대분류 이름입니다.', 'warn');
        return;
      }
      appState.masterCategories[val] = [];
      saveMasterCategories();
      populateFilterDropdowns(); // update dropdowns globally
      renderTable();
      renderManageMainCategories();
      e.target.reset();
      showToast(`대분류 '${val}'가 추가되었습니다.`, 'success');
    });

    document.getElementById('newSubCategoryForm')?.addEventListener('submit', e => {
      e.preventDefault();
      const mainCat = appState.activeManageMainCat;
      const val = document.getElementById('newSubCategoryName').value.trim();
      if (!mainCat || !val || appState.masterCategories[mainCat].includes(val)) {
        showToast('이미 존재하거나 잘못된 소분류 이름입니다.', 'warn');
        return;
      }
      appState.masterCategories[mainCat].push(val);
      saveMasterCategories();
      populateFilterDropdowns();
      renderTable();
      renderManageSubCategories();
      e.target.reset();
      showToast(`'${mainCat}'에 소분류 '${val}'가 추가되었습니다.`, 'success');
    });

    document.getElementById('mainCategoryList')?.addEventListener('click', e => {
      // Select Main Category
      if (e.target.closest('.main-cat-item') && !e.target.closest('.btn-delete-main-cat')) {
        const item = e.target.closest('.main-cat-item');
        appState.activeManageMainCat = item.dataset.cat;
        document.querySelectorAll('.main-cat-item').forEach(el => el.style.background = 'transparent');
        item.style.background = 'var(--bg-input)';
        renderManageSubCategories();
      }
      
      // Delete Main Category
      if (e.target.closest('.btn-delete-main-cat')) {
        const cat = e.target.closest('.btn-delete-main-cat').dataset.cat;
        if (confirm(`대분류 '${cat}'와 속한 모든 소분류를 삭제하시겠습니까? (기존 내역의 데이터는 유지됩니다)`)) {
          delete appState.masterCategories[cat];
          if (appState.activeManageMainCat === cat) {
            appState.activeManageMainCat = null;
          }
          saveMasterCategories();
          populateFilterDropdowns();
          renderTable();
          renderManageMainCategories();
          renderManageSubCategories();
          showToast(`대분류 '${cat}'가 삭제되었습니다.`);
        }
      }
    });

    document.getElementById('subCategoryList')?.addEventListener('click', e => {
      if (e.target.closest('.btn-delete-sub-cat')) {
        const sub = e.target.closest('.btn-delete-sub-cat').dataset.sub;
        const mainCat = appState.activeManageMainCat;
        if (mainCat && appState.masterCategories[mainCat]) {
          appState.masterCategories[mainCat] = appState.masterCategories[mainCat].filter(s => s !== sub);
          saveMasterCategories();
          populateFilterDropdowns();
          renderTable();
          renderManageSubCategories();
          showToast(`소분류 '${sub}'가 삭제되었습니다.`);
        }
      }
    });

    function renderManageMainCategories() {
      const container = document.getElementById('mainCategoryList');
      if (!container) return;
      container.innerHTML = '';
      const mainCats = Object.keys(appState.masterCategories);
      if (mainCats.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:0.9rem; padding:10px;">대분류가 없습니다.</div>';
        return;
      }
      mainCats.forEach(cat => {
        const div = document.createElement('div');
        div.className = 'main-cat-item';
        div.dataset.cat = cat;
        div.style.padding = '10px';
        div.style.borderRadius = '4px';
        div.style.cursor = 'pointer';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.border = '1px solid transparent';
        if (appState.activeManageMainCat === cat) {
          div.style.background = 'var(--bg-input)';
          div.style.border = '1px solid var(--border-focus)';
        } else {
          div.style.background = 'transparent';
          div.addEventListener('mouseenter', () => div.style.background = 'var(--bg-surface)');
          div.addEventListener('mouseleave', () => { if(appState.activeManageMainCat !== cat) div.style.background = 'transparent'; });
        }
        
        div.innerHTML = `
          <span style="font-weight: 600; font-size: 0.95rem;">${cat}</span>
          <button type="button" class="btn-delete-main-cat" data-cat="${cat}" style="background:none; border:none; color:var(--text-muted); cursor:pointer;">&times;</button>
        `;
        container.appendChild(div);
      });
    }

    function renderManageSubCategories() {
      const container = document.getElementById('subCategoryList');
      const textTitle = document.getElementById('selectedMainCategoryText');
      if (!container || !textTitle) return;
      
      container.innerHTML = '';
      const mainCat = appState.activeManageMainCat;
      
      if (!mainCat) {
        textTitle.textContent = '';
        container.innerHTML = '<div style="color:var(--text-muted); font-size:0.9rem; text-align:center; margin-top:20px;">대분류를 먼저 선택해주세요.</div>';
        document.getElementById('newSubCategoryName').disabled = true;
        return;
      }
      
      textTitle.textContent = `(${mainCat})`;
      document.getElementById('newSubCategoryName').disabled = false;
      
      const subCats = appState.masterCategories[mainCat] || [];
      if (subCats.length === 0) {
        container.innerHTML = '<div style="color:var(--text-muted); font-size:0.9rem; padding:10px;">등록된 소분류가 없습니다.</div>';
        return;
      }
      
      subCats.forEach(sub => {
        const div = document.createElement('div');
        div.style.padding = '8px 12px';
        div.style.borderRadius = '4px';
        div.style.background = 'var(--bg-surface)';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        
        div.innerHTML = `
          <span style="font-size: 0.9rem;">${sub}</span>
          <button type="button" class="btn-delete-sub-cat" data-sub="${sub}" style="background:none; border:none; color:var(--text-muted); cursor:pointer;">&times;</button>
        `;
        container.appendChild(div);
      });
    }

    // Excel File Upload
    document.getElementById('excelFileInput')?.addEventListener('change', handleExcelUpload);
  }

  // --- Excel Export (SheetJS) ---
  function exportToExcel() {
    if (typeof XLSX === 'undefined') {
      alert('엑셀 라이브러리가 로드되지 않았습니다.');
      return;
    }

    // 1. Transaction Sheet
    const txHeaders = [
      'No.', '날짜', '시간', '월', '대분류', '소분류', '내용(가맹점)',
      '지출금액', '원본 결제수단', '실제 결제카드 (수정 가능)',
      '할부 개월', '이번달 청구액', '제외 여부', '메모'
    ];

    const txRows = appState.records.map(r => [
      r.id, r.date, r.time, r.month, r.category, r.subCategory, r.merchant,
      r.amount, r.origPay, r.actualCard, r.installment, r.billingAmount, r.exclude, r.memo
    ]);

    const wsTx = XLSX.utils.aoa_to_sheet([txHeaders, ...txRows]);

    // 2. Summary Sheet
    const summaryRows = [
      ['카드별 지출 현황 및 가계부 대시보드 요약'],
      ['기준일자', new Date().toLocaleDateString('ko-KR')],
      ['총 거래건수', appState.records.length],
      [''],
      ['카드명', '지출금액 (원)', '건수', '비중(%)']
    ];

    const cardSums = {};
    const cardCounts = {};
    let totalSpent = 0;
    appState.records.forEach(r => {
      if (r.exclude === 'Y') return;
      cardSums[r.actualCard] = (cardSums[r.actualCard] || 0) + r.amount;
      cardCounts[r.actualCard] = (cardCounts[r.actualCard] || 0) + 1;
      totalSpent += r.amount;
    });

    Object.keys(cardSums).sort((a, b) => cardSums[b] - cardSums[a]).forEach(c => {
      const share = totalSpent > 0 ? ((cardSums[c] / totalSpent) * 100).toFixed(1) : 0;
      summaryRows.push([c, cardSums[c], cardCounts[c], Number(share)]);
    });

    summaryRows.push(['총계 (포함 항목)', totalSpent, '']);

    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsSummary, '대시보드_요약');
    XLSX.utils.book_append_sheet(wb, wsTx, '지출_카드별정리');

    const todayStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `가계부_카드별_지출정리_${todayStr}.xlsx`);
    showToast('수정된 엑셀 파일이 성공적으로 다운로드되었습니다!', 'success');
  }

  // --- Excel File Upload ---
  function handleExcelUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const sheetName = wb.SheetNames.includes('지출_카드별정리') ? '지출_카드별정리' : wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });

        if (rows.length < 2) {
          alert('엑셀 파일에 유효한 데이터가 없습니다.');
          return;
        }

        const newRecords = [];
        for (let r = 1; r < rows.length; r++) {
          const row = rows[r];
          if (!row || (!row[0] && !row[1])) continue;
          if (row[0] === '총 합 계' || row[0] === '합계') continue;

          newRecords.push({
            id: Number(row[0]) || r,
            date: String(row[1] || '').slice(0, 10),
            time: String(row[2] || ''),
            month: String(row[3] || ''),
            category: String(row[4] || '기타'),
            subCategory: String(row[5] || ''),
            merchant: String(row[6] || ''),
            amount: Number(row[7]) || 0,
            origPay: String(row[8] || ''),
            actualCard: String(row[9] || '기타 카드'),
            installment: String(row[10] || '일시불'),
            billingAmount: Number(row[11]) || Number(row[7]) || 0,
            exclude: String(row[12] || 'N').trim().toUpperCase() === 'Y' ? 'Y' : 'N',
            memo: String(row[13] || '')
          });
        }

        if (newRecords.length > 0) {
          applyCategoryRules(newRecords);
          appState.records = newRecords;
          saveData();
          populateFilterDropdowns();
          renderAll();
          showToast(`새로운 엑셀 파일에서 ${newRecords.length}건을 성공적으로 불러왔습니다!`, 'success');
        }
      } catch (err) {
        console.error(err);
        alert('엑셀 파일을 파싱하는 중 오류가 발생했습니다: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = ''; // reset file input
  }

  // --- Run on DOM Ready ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
