const assert = require('node:assert/strict');
const test = require('node:test');

const { parseSalaryK, parseWorkYears, clientFilter, normalizeFilters, zhipinNativeFilters, liepinNativeFilters } = require('../dist/platforms/filters');

test('parseSalaryK 解析各平台薪资文本', () => {
  assert.deepEqual(parseSalaryK('15-30K·15薪'), [15, 30]);
  assert.deepEqual(parseSalaryK('1.1-1.6万'), [11, 16]);
  assert.deepEqual(parseSalaryK('6-9千'), [6, 9]);
  assert.deepEqual(parseSalaryK('8000-15000元'), [8, 15]);
  assert.deepEqual(parseSalaryK('20-50K'), [20, 50]);
  assert.deepEqual(parseSalaryK('15K以上'), [15, Infinity]);
  assert.deepEqual(parseSalaryK('3K以下'), [0, 3]);
  assert.deepEqual(parseSalaryK('面议'), null);
});

test('parseWorkYears 解析年限文本', () => {
  assert.deepEqual(parseWorkYears('1-3年'), [1, 3]);
  assert.deepEqual(parseWorkYears('3-5年经验'), [3, 5]);
  assert.deepEqual(parseWorkYears('5年以上'), [5, 99]);
  assert.deepEqual(parseWorkYears('经验不限'), [0, 99]);
  assert.deepEqual(parseWorkYears('应届毕业生'), [0, 0]);
  assert.deepEqual(parseWorkYears(''), null);
});

test('clientFilter 薪资区间交集过滤', () => {
  const jobs = [
    { salary: '15-30K·15薪' },   // [15,30] 与 10-20K 有交集 → 过
    { salary: '3-5K' },          // [3,5] 无交集 → 删
    { salary: '面议' },          // 无法解析 → 放行
    { salary: '25-45K·16薪' }    // [25,45] 无交集 → 删
  ];
  const out = clientFilter(jobs, normalizeFilters({ salary: '10-20K' }));
  assert.equal(out.length, 2);
  assert.equal(out[0].salary, '15-30K·15薪');
  assert.equal(out[1].salary, '面议');
});

test('clientFilter 年限区间过滤', () => {
  const jobs = [
    { workYearString: '3-5年' },   // 与 1-3年 无交集（3≤3 有交集：have[0]=3 ≤ want[1]=3）→ 过
    { workYearString: '10年以上' }, // [10,99] 与 [1,3] 无交集 → 删
    { workYearString: '经验不限' }, // [0,99] → 过
    { workYearString: '1年以下' }   // [0,1] → 过
  ];
  const out = clientFilter(jobs, normalizeFilters({ workYear: '1-3年' }));
  assert.equal(out.length, 3);
});

test('原生筛选码映射', () => {
  assert.deepEqual(zhipinNativeFilters({ workYear: '1-3年', salary: '10-20K' }), { experience: '103', salary: '404' });
  assert.deepEqual(liepinNativeFilters({ workYear: '1-3年', salary: '10-15万' }), { workYearCode: '1$3', salaryCode: '2' });
  assert.deepEqual(zhipinNativeFilters({ workYear: '未知格式' }), {});
});
