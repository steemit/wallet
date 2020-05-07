/* eslint react/prop-types: 0 */
import React from 'react';
import { connect } from 'react-redux';
import { Link } from 'react-router';
import tt from 'counterpart';
import { List } from 'immutable';
import SavingsWithdrawHistory from 'app/components/elements/SavingsWithdrawHistory';
import TransferHistoryRow from 'app/components/cards/TransferHistoryRow';
import TimeAgoWrapper from 'app/components/elements/TimeAgoWrapper';
import {
    numberWithCommas,
    vestingSteem,
    delegatedSteem,
    powerdownSteem,
    pricePerSteem,
} from 'app/utils/StateFunctions';
import WalletSubMenu from 'app/components/elements/WalletSubMenu';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import Tooltip from 'app/components/elements/Tooltip';
import { FormattedHTMLMessage } from 'app/Translator';
import {
    LIQUID_TOKEN,
    LIQUID_TICKER,
    DEBT_TOKENS,
    VESTING_TOKEN,
} from 'app/client_config';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import DropdownMenu from 'app/components/elements/DropdownMenu';

const assetPrecision = 1000;

class Delegations extends React.Component {
    constructor() {
        super();
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'Delegations');
    }

    render() {
        const {
            convertToSteem,
            price_per_steem,
            savings_withdraws,
            account,
            currentUser,
            open_orders,
        } = this.props;
        const gprops = this.props.gprops.toJS();

        // do not render if account is not loaded or available
        if (!account) return null;

        // do not render if state appears to contain only lite account info
        if (!account.has('vesting_shares')) return null;

        const vesting_steem = vestingSteem(account.toJS(), gprops);
        const delegated_steem = delegatedSteem(account.toJS(), gprops);
        const powerdown_steem = powerdownSteem(account.toJS(), gprops);

        const isMyAccount =
            currentUser && currentUser.get('username') === account.get('name');

        // Used to show delegation transfer modal.
        const showTransfer = (asset, transferType, e) => {
            e.preventDefault();
            this.props.showTransfer({
                to: isMyAccount ? null : account.get('name'),
                asset,
                transferType,
            });
        };

        /// transfer log
        let idx = 0;
        debugger;
        // https://github.com/steemit/steem-js/tree/master/doc#get-vesting-delegations
        const delegation_log = account
            .get('transfer_history')
            .map(item => {
                const data = item.getIn([1, 'op', 1]);
                const type = item.getIn([1, 'op', 0]);

                // Filter out rewards
                if (
                    type === 'curation_reward' ||
                    type === 'author_reward' ||
                    type === 'comment_benefactor_reward'
                ) {
                    return null;
                }

                if (
                    data.sbd_payout === '0.000 SBD' &&
                    data.vesting_payout === '0.000000 VESTS'
                )
                    return null;
                return (
                    <TransferHistoryRow
                        key={idx++}
                        op={item.toJS()}
                        context={account.get('name')}
                    />
                );
            })
            .filter(el => !!el)
            .reverse();

        const power_menu = [
            {
                value: tt('userwallet_jsx.delegate'),
                link: '#',
                onClick: showTransfer.bind(
                    this,
                    'DELEGATE_VESTS',
                    'Delegate to Account'
                ),
            },
        ];

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
                        {/** history */}
                        <h4>{tt('userwallet_jsx.history')}</h4>
                        <div className="secondary">
                            <span>
                                {tt(
                                    'transfer_jsx.beware_of_spam_and_phishing_links'
                                )}
                            </span>
                            &nbsp;
                            <span>
                                {tt(
                                    'transfer_jsx.transactions_make_take_a_few_minutes'
                                )}
                            </span>
                        </div>
                        <table>
                            <tbody>{delegation_log}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }
}

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const price_per_steem = pricePerSteem(state);
        const savings_withdraws = state.user.get('savings_withdraws');
        const gprops = state.global.get('props');
        const sbd_interest = gprops.get('sbd_interest_rate');
        return {
            ...ownProps,
            open_orders: state.market.get('open_orders'),
            price_per_steem,
            savings_withdraws,
            sbd_interest,
            gprops,
        };
    },
    // mapDispatchToProps
    dispatch => ({})
)(Delegations);
