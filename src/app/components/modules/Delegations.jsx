import React from 'react';
import tt from 'counterpart';
import ExpiringDelegations from 'app/components/elements/ExpiringDelegations'
import OutgoingDelegations from 'app/components/elements/OutgoingDelegations'
import WalletSubMenu from 'app/components/elements/WalletSubMenu';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';

const OUTGOING_DELEGATIONS = "OUTGOING_DELEGATIONS"
const EXPIRING_DELEGATIONS = "EXPIRING_DELEGATIONS"

class Delegations extends React.Component {
    constructor() {
        super();
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'Delegations');
        this.state = {
            activeSection: OUTGOING_DELEGATIONS
        };
    }

    handleClick = (section) => {
        this.setState({ activeSection: section });
    }

    render() {
        const { activeSection } = this.state;

        const {
            account,
            currentUser,
        } = this.props;

        const isMyAccount =
            currentUser && currentUser.get('username') === account.get('name');
        // do not render if account is not loaded or available
        if (!account) return null;
        // do not render if state appears to contain only lite account info
        if (!account.has('vesting_shares')) return null;

        return (
            <div className="UserWallet">
                <div className="row">
                    <div className="columns small-10 medium-12 medium-expand">
                        <WalletSubMenu
                            accountname={account.get('name')}
                            isMyAccount={isMyAccount}
                        />
                    </div>
                </div>
                <div className="row">
                    <div className="column small-12">
                        <div className="Delegations-menu">
                            <button
                                className={`${activeSection === OUTGOING_DELEGATIONS ? 'Delegations__btn--active ' : ''}Delegations__btn button hollow`}
                                onClick={() => this.handleClick(OUTGOING_DELEGATIONS)}
                            >
                                {tt('outgoingdelegations_jsx.title')}
                            </button>
                            <button
                                className={`${activeSection === EXPIRING_DELEGATIONS ? 'Delegations__btn--active ' : ''}Delegations__btn button hollow`}
                                onClick={() => this.handleClick(EXPIRING_DELEGATIONS)}
                            >
                                {tt('expiringdelegations_jsx.title')}
                            </button>
                        </div>
                        {activeSection === OUTGOING_DELEGATIONS &&
                            <OutgoingDelegations
                                account={account}
                                currentUser={currentUser}
                            />
                        }
                        {activeSection === EXPIRING_DELEGATIONS &&
                            <ExpiringDelegations
                                account={account}
                                currentUser={currentUser}
                            />
                        }
                    </div>
                </div>
            </div>
        );
    }
}

export default Delegations;

