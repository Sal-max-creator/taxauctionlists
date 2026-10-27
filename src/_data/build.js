export default function () {
  return { date: new Date().toISOString().slice(0, 10) };
}
