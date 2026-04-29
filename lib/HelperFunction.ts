export const generateNonce = (length = 32) => {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return (
    "0x" +
    Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join("")
  );
};

export const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export const formatAddress = (address: string) =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;

export const formatDeadline = (deadline: string) =>
  new Date(deadline).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
