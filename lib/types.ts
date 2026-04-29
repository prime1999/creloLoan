export type LoanRecord = {
  user_address: `0x${string}`;
  total_debt: number;
  remaining_debt: number;
  deadline: string;
  status: string;
  borrow_signature: `0x${string}`;
  permit_v: number;
  permit_r: `0x${string}`;
  permit_s: `0x${string}`;
  is_processed: boolean;
};

export type LoanCardProps = {
  loan: {
    user_address: `0x${string}`;
    total_debt: number;
    remaining_debt: number;
    deadline: string;
    status: string;
    borrow_signature: `0x${string}`;
    permit_v: number;
    permit_r: `0x${string}`;
    permit_s: `0x${string}`;
    is_processed: boolean;
  };
};
