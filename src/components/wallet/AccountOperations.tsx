
import AccountSecurityOperations from "./AccountSecurityOperations";
import WitnessManagement from "./WitnessManagement";
import { useSteemAccount } from "@/hooks/useSteemAccount";

const AccountOperations = () => {
  const loggedInUser = localStorage.getItem('steem_username');
  const { data: accountData } = useSteemAccount(loggedInUser || '');

  return (
    <div className="space-y-6">
      <AccountSecurityOperations 
        loggedInUser={loggedInUser}
        accountData={accountData}
      />
      <WitnessManagement loggedInUser={loggedInUser} />
    </div>
  );
};

export default AccountOperations;
