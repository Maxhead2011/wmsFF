// TEST: run against a browser fixture with the actual ExpensesPanel and PayrollManagement components.
module.exports = async function verifyPayrollNavigation(page) {
  await page.getByRole('button', { name: /^ФОТ/ }).click();
  await page.getByRole('button', { name: '← К расходам', exact: true }).waitFor();
  if (await page.getByRole('navigation', { name: 'Разделы расходов' }).count()) throw Error('Other expense tabs leaked into FOT');
  if (await page.getByText('Период с', { exact: true }).count()) throw Error('Duplicate expense date filter');
  await page.getByRole('cell', { name: '17:00', exact: true }).waitFor();
  await page.getByRole('cell', { name: '23:59', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Редактировать', exact: true }).click();
  if (await page.locator('[name=historyStart]').inputValue() !== '17:00') throw Error('Start not prefilled');
  if (await page.locator('[name=historyEnd]').inputValue() !== '23:59') throw Error('End not prefilled');
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить запись вручную', exact: true }).click();
  await page.getByRole('heading', { name: 'Добавить приход и уход', exact: true }).waitFor();
  await page.getByRole('button', { name: '← К расходам', exact: true }).click();
  await page.getByRole('button', { name: /^Расходные материалы/ }).waitFor();
  await page.getByRole('button', { name: /^ФОТ/ }).click();
  await page.getByRole('button', { name: 'Настройки', exact: true }).click();
  await page.getByRole('heading', { name: 'Добавить сотрудника', exact: true }).waitFor();
};
