/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable react/jsx-no-bind */
/* eslint-disable no-plusplus */
/* eslint-disable no-undef */
/* eslint react/prop-types: 0 */
import React from 'react';
import { connect } from 'react-redux';
import { Link } from 'react-router';
import tt from 'counterpart';
import { CopyToClipboard } from 'react-copy-to-clipboard';
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
import * as userActions from 'app/redux/UserReducer';
import * as appActions from 'app/redux/AppReducer';
import { recordAdsView, userActionRecord } from 'app/utils/ServerApiClient';
import QRCode from 'react-qr';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import ConversionsModal from 'app/components/elements/ConversionsModal';
import ChangeRecoveryAccount from 'app/components/modules/ChangeRecoveryAccount';
import { fetchData } from 'app/utils/steemApi';

const DAYS_TO_HIDE = 5;
const assetPrecision = 1000;

class UserWallet extends React.Component {
    constructor() {
        super();
        this.state = {
            claimInProgress: false,
            showQR: false,
            hasClicked: false,
            timestamp: null,
            showChangeRecoveryModal: false,
            showConversionsModal: false,
            conversions: [],
            conversionValue: 0,
            sbdPrice: 0,
        };
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'UserWallet');
    }

    componentDidMount() {
        const { account, getWithdrawRoutes } = this.props;
        if (account && getWithdrawRoutes) {
            getWithdrawRoutes(account.get('name'));
        }
    }

    // All event handlers are defined as class methods for performance and stable 'this' context.
    onShowSteemTrade = e => {
        if (e && e.preventDefault) e.preventDefault();
        recordAdsView({
            trackingId: this.props.trackingId,
            adTag: 'TradeSteemBtn',
        });
        const new_window = window.open();
        new_window.opener = null;
        new_window.location =
            'https://poloniex.com/trade/STEEM_TRX/?type=spot';
    };

    onShowSteemTradeTop = e => {
        if (e && e.preventDefault) e.preventDefault();
        recordAdsView({
            trackingId: this.props.trackingId,
            adTag: 'TradeSteemTop',
        });
        const new_window = window.open();
        new_window.opener = null;
        new_window.location =
            'https://poloniex.com/trade/STEEM_TRX/?type=spot';
    };

    onShowTrxTrade = e => {
        if (e && e.preventDefault) e.preventDefault();
        recordAdsView({
            trackingId: this.props.trackingId,
            adTag: 'TradeTrx',
        });
        const new_window = window.open();
        new_window.opener = null;
        new_window.location =
            'https://poloniex.com/trade/TRX_USDT/?type=spot';
    };

    onShowTronLink = e => {
        if (e && e.preventDefault) e.preventDefault();
        recordAdsView({
            trackingId: this.props.trackingId,
            adTag: 'ToTronLink',
        });
        const new_window = window.open();
        new_window.opener = null;
        new_window.location = 'https://www.tronlink.org/';
    };

    onShowTradeSBD = e => {
        e.preventDefault();
        recordAdsView({
            trackingId: this.props.trackingId,
            adTag: 'TradeSBD',
        });
        const new_window = window.open();
        new_window.opener = null;
        new_window.location =
            'https://global.bittrex.com/Market/Index?MarketName=BTC-SBD';
    };

    showQR = e => {
        this.setState({ showQR: true });
    };

    async componentDidMount() {
        const { prices, updatePrices, account, currentUser } = this.props;
        const lastUpdate = prices.get('lastUpdate');
        const oneHour = 60 * 60 * 1000;
        const now = Date.now();
        if (!lastUpdate || now - lastUpdate > oneHour) {
            updatePrices();
        }
        const isMyAccount = currentUser && currentUser.get('username') === account.get('name');
        await this.loadInitialConversions();
        if (account && currentUser && isMyAccount) {
            try {
                const userName = account.get('name');
                const storageKey = `button_click_${userName}`;
                const storedData = localStorage.getItem(storageKey);
                if (storedData) {
                    const recoveryInfo = account.get('account_recovery');
                    const parsed = JSON.parse(storedData);
                    const recoveryAccount = recoveryInfo ? recoveryInfo.get('recovery_account') : null;
                    if (parsed.recovery_account !== recoveryAccount) {
                        localStorage.removeItem(storageKey);
                        return;
                    }
                    if (parsed.clicked && parsed.timestamp) {
                        const timestampDate = new Date(parsed.timestamp);
                        const diffTime = now - timestampDate;
                        const diffDays = diffTime / (1000 * 60 * 60 * 24);
                        if (diffDays <= DAYS_TO_HIDE) {
                            this.setWarningState(parsed.timestamp);
                        } else {
                            localStorage.removeItem(storageKey);
                        }
                    }
                }
            } catch (e) {
                console.warn("[componentDidMount] Error parsing localStorage data:", e);
            }
        }
    }

    async componentDidUpdate(prevProps) {
        const { prices, updatePrices, account, currentUser } = this.props;
        const lastUpdate = prices.get('lastUpdate');
        const oneHour = 60 * 60 * 1000;
        const now = Date.now();
        if (
            prices !== prevProps.prices && accountChanged &&
            (!lastUpdate || now - lastUpdate > oneHour)
        ) {
            updatePrices();
        }
        const accountChanged = account !== prevProps.account;
        let currentUserChange = false;
        if (currentUser) {
            const currentUsername = currentUser.get('username');
            if (!prevProps.currentUser) {
                currentUserChange = true;
            } else {
                const prevUsername = prevProps.currentUser.get('username');
                if (currentUsername !== prevUsername) {
                    currentUserChange = true;
                }
            }
        }
        const isMyAccount = currentUser && currentUser.get('username') === account.get('name');
        const currentHistorySize = account.get('other_history', List()).size;
        const prevHistorySize = prevProps.account.get('other_history', List()).size;
        if (accountChanged) {
            await this.loadInitialConversions();
        } else if (!accountChanged && currentHistorySize !== prevHistorySize) {
            await this.loadInitialConversions();
        }
        if (account && currentUserChange && currentUser && isMyAccount) {
            try {
                const userName = account.get('name');
                const storageKey = `button_click_${userName}`;
                const storedData = localStorage.getItem(storageKey);
                if (storedData) {
                    const recoveryInfo = account.get('account_recovery');
                    const parsed = JSON.parse(storedData);
                    const recoveryAccount = recoveryInfo ? recoveryInfo.get('recovery_account') : null;
                    if (parsed.recovery_account !== recoveryAccount) {
                        localStorage.removeItem(storageKey);
                        return;
                    }
                    if (parsed.clicked && parsed.timestamp) {
                        const timestampDate = new Date(parsed.timestamp);
                        const diffTime = now - timestampDate;
                        const diffDays = diffTime / (1000 * 60 * 60 * 24);
                        if (diffDays <= DAYS_TO_HIDE) {
                            this.setWarningState(parsed.timestamp);
                        } else {
                            localStorage.removeItem(storageKey);
                        }
                    }
                }
            } catch (e) {
                console.warn("[componentDidUpdate] Error parsing localStorage data:", e);
            }
        }
    }

    async loadInitialConversions() {
        try {
            const account = this.props.account;
            const accountName = account.get('name');
            const currentTime = Date.now();
            let conversionValue = 0;
            const result = await fetchData('database_api.find_sbd_conversion_requests', { account: accountName }, 1);
            const requests = result.requests || [];
            const initialConversions = requests.reduce((out, request) => {
                const rawTimestamp = request.conversion_date;
                const timestamp = new Date(rawTimestamp.endsWith('Z') ? rawTimestamp : rawTimestamp + 'Z').getTime();
                const finishTime = timestamp;
                if (finishTime < currentTime) return out;
                const amount = parseFloat(request.amount.amount) / (10 ** request.amount.precision);
                conversionValue += amount;
                out.push({
                    id: request.id,
                    amount,
                    finishTime,
                    owner: request.owner,
                    requestid: request.requestid,
                });
                return out;
            }, []);
            this.setState({
                conversions: initialConversions,
                conversionValue,
            });
        } catch (e) {
            console.warn("Error loading initial conversions:", e);
        }
    }

    hideChangeRecoveryModal = (show = false) => {
        this.setState({ showChangeRecoveryModal: show });
    };

    setWarningState = (timestamp) => {
        this.setState({
            hasClicked: true,
            timestamp,
            });
    }

    handleClaimRewards = account => {
        let isClaiming = false;
        if (parseFloat(account.get('reward_vesting_steem').split(' ')[0]) > 0) {
            isClaiming = true;
            this.props.claimRewards(account);
        }
        if (isClaiming === true) {
            this.setState({ claimInProgress: true }); // disable the claim button
        }
    };

    showAdvanced = e => {
        e.preventDefault();
        const { account } = this.props;
        this.props.showAdvanced({
            account: account.get('name'),
        });
    };

    getCurrentApr = gprops => {
        // The inflation was set to 9.5% at block 7m
        const initialInflationRate = 9.5;
        const initialBlock = 7000000;

        // It decreases by 0.01% every 250k blocks
        const decreaseRate = 250000;
        const decreasePercentPerIncrement = 0.01;

        // How many increments have happened since block 7m?
        const headBlock = gprops.head_block_number;
        const deltaBlocks = headBlock - initialBlock;
        const decreaseIncrements = deltaBlocks / decreaseRate;

        // Current inflation rate
        let currentInflationRate =
            initialInflationRate -
            decreaseIncrements * decreasePercentPerIncrement;

        // Cannot go lower than 0.95%
        if (currentInflationRate < 0.95) {
            currentInflationRate = 0.95;
        }

        // Now lets calculate the "APR"
        const vestingRewardPercent = gprops.vesting_reward_percent / 10000;
        if (
            gprops.virtual_supply === undefined ||
            gprops.total_vesting_fund_steem === undefined
        ) {
            return 0;
        }
        const virtualSupply = gprops.virtual_supply.split(' ').shift();
        const totalVestingFunds = gprops.total_vesting_fund_steem
            .split(' ')
            .shift();
        return (
            (virtualSupply * currentInflationRate * vestingRewardPercent) /
            totalVestingFunds
        );
    };

    onShowAllConversions = () => {
        this.setState({ showConversionsModal: true });
    };

    render() {
        const {
            convertToSteem,
            prices,
            price_per_steem,
            savings_withdraws,
            account,
            currentUser,
            open_orders,
            notify,
            withdraw_routes,
        } = this.props;
        const { showQR, hasClicked, showChangeRecoveryModal, conversionValue  } = this.state;
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

        const disabledWarning = false;
        // isMyAccount = false; // false to hide wallet transactions

        const showTransfer = (asset, transferType, e) => {
            e.preventDefault();
            this.props.showTransfer({
                to: isMyAccount ? null : account.get('name'),
                asset,
                transferType,
            });
        };

        const savings_balance = account.get('savings_balance');
        const savings_sbd_balance = account.get('savings_sbd_balance');

        const powerDown = (cancel, e) => {
            e.preventDefault();
            const name = account.get('name');
            if (cancel) {
                const vesting_shares = cancel
                    ? '0.000000 VESTS'
                    : account.get('vesting_shares');
                this.setState({ toggleDivestError: null });
                const errorCallback = e2 => {
                    this.setState({ toggleDivestError: e2.toString() });
                };
                const successCallback = () => {
                    userActionRecord('cancel_withdraw_vesting', {
                        username: currentUser.get('username'),
                    });
                    this.setState({ toggleDivestError: null });
                };
                this.props.withdrawVesting({
                    account: name,
                    vesting_shares,
                    errorCallback,
                    successCallback,
                });
            } else {
                const to_withdraw = account.get('to_withdraw');
                const withdrawn = account.get('withdrawn');
                const vesting_shares = account.get('vesting_shares');
                const delegated_vesting_shares = account.get(
                    'delegated_vesting_shares'
                );
                this.props.showPowerdown({
                    account: name,
                    to_withdraw,
                    withdrawn,
                    vesting_shares,
                    delegated_vesting_shares,
                });
            }
        };

        // Sum savings withrawals
        let savings_pending = 0,
            savings_sbd_pending = 0;
        if (savings_withdraws) {
            savings_withdraws.forEach(withdraw => {
                const [amount, asset] = withdraw.get('amount').split(' ');
                if (asset === 'STEEM') savings_pending += parseFloat(amount);
                else if (asset === 'SBD')
                    savings_sbd_pending += parseFloat(amount);
            });
        }

        const balance_steem = parseFloat(account.get('balance').split(' ')[0]);
        const saving_balance_steem = parseFloat(
            savings_balance.split(' ')[0]
        );
        const divesting =
            parseFloat(account.get('vesting_withdraw_rate').split(' ')[0]) >
            0.0;
        const sbd_balance = parseFloat(account.get('sbd_balance'));
        const sbd_balance_savings = parseFloat(
            savings_sbd_balance.split(' ')[0]
        );
        const sbdOrders =
            !open_orders || !isMyAccount
                ? 0
                : open_orders.reduce((o, order) => {
                      if (order.sell_price.base.indexOf('SBD') !== -1) {
                          o += order.for_sale;
                      }
                      return o;
                  }, 0) / assetPrecision;

        const steemOrders =
            !open_orders || !isMyAccount
                ? 0
                : open_orders.reduce((o, order) => {
                      if (order.sell_price.base.indexOf('STEEM') !== -1) {
                          o += order.for_sale;
                      }
                      return o;
                  }, 0) / assetPrecision;
        const conversionsTotal = this.props.conversionsSuccess
            ? this.props.conversionsSuccess.reduce((sum, item) => {
                const amount = parseFloat(item.get('amount').split(' ')[0]);
                return sum + (isNaN(amount) ? 0 : amount);
            }, 0)
            : 0;
        // set displayed estimated value
        const total_sbd =
            sbd_balance +
            sbd_balance_savings +
            savings_sbd_pending +
            sbdOrders +
            conversionValue +
            conversionsTotal;

        const total_steem =
            vesting_steem +
            balance_steem +
            saving_balance_steem +
            savings_pending +
            steemOrders;
        const steemPrice = prices.get('steemPrice');
        const sbdPrice = prices.get('sbdPrice');
        let total_value = '$0.00';
        if (steemPrice > 0 && sbdPrice > 0) {
            const total_value_usd = (total_steem * steemPrice) + (total_sbd * sbdPrice);
            total_value = '$' + numberWithCommas(total_value_usd.toFixed(2));
        } else {
            const total_value_usd = (total_steem * steemPrice) + total_sbd;
            total_value = '$' + numberWithCommas(total_value_usd.toFixed(2));
        }

        // format spacing on estimated value based on account state
        let estimate_output = <p>{total_value}</p>;
        if (isMyAccount) {
            estimate_output = <p>{total_value}&nbsp; &nbsp; &nbsp;</p>;
        }

        /// transfer log
        let transfer_log = null;
        // only render on client side
        if (typeof window !== 'undefined') {
            let idx = 0;
            try {
                transfer_log = account
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
            } catch (e) {
                console.error(e);
                transfer_log = null;
            }
        }

        const steem_menu = [
            {
                value: tt('userwallet_jsx.transfer'),
                link: '#',
                onClick: showTransfer.bind(
                    this,
                    'STEEM',
                    'Transfer to Account'
                ),
            },
            {
                value: tt('userwallet_jsx.transfer_to_savings'),
                link: '#',
                onClick: showTransfer.bind(
                    this,
                    'STEEM',
                    'Transfer to Savings'
                ),
            },
            {
                value: tt('userwallet_jsx.power_up'),
                link: '#',
                onClick: showTransfer.bind(
                    this,
                    'VESTS',
                    'Transfer to Account'
                ),
            },
        ];
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
            {
                value: tt('userwallet_jsx.power_down'),
                link: '#',
                onClick: powerDown.bind(this, false),
            },
            {
                value: tt('userwallet_jsx.advanced_routes'),
                link: '#',
                onClick: this.showAdvanced,
            },
        ];
        const dollar_menu = [
            {
                value: tt('g.transfer'),
                link: '#',
                onClick: showTransfer.bind(this, 'SBD', 'Transfer to Account'),
            },
            {
                value: tt('userwallet_jsx.transfer_to_savings'),
                link: '#',
                onClick: showTransfer.bind(this, 'SBD', 'Transfer to Savings'),
            },
            {
                value: tt('userwallet_jsx.convert_to_LIQUID_TOKEN', {
                    LIQUID_TOKEN: typeof LIQUID_TOKEN === 'string' ? LIQUID_TOKEN.toUpperCase() : LIQUID_TOKEN,
                }),
                link: '#',
                onClick: convertToSteem,
            },
            { value: tt('userwallet_jsx.market'), link: '/market' },
        ];
        if (isMyAccount) {
            steem_menu.push({
                value: tt('g.trade'),
                link: '#',
                onClick: this.onShowSteemTrade,
            });
            steem_menu.push({
                value: tt('userwallet_jsx.market'),
                link: '/market',
            });
            // power_menu.push({
            //     value: tt('g.buy'),
            //     link: '#',
            //     onClick: onShowDepositPower.bind(
            //         this,
            //         currentUser.get('username')
            //     ),
            // });
            dollar_menu.push({
                value: tt('g.trade'),
                link: '#',
                onClick: this.onShowTradeSBD,
            });
        }

        if (divesting) {
            power_menu.push({
                value: 'Cancel Power Down',
                link: '#',
                onClick: powerDown.bind(this, true),
            });
        }

        const steem_balance_str = numberWithCommas(balance_steem.toFixed(3));
        const steem_orders_balance_str = numberWithCommas(
            steemOrders.toFixed(3)
        );
        const power_balance_str = numberWithCommas(vesting_steem.toFixed(3));
        const received_power_balance_str =
            (delegated_steem < 0 ? '+' : '') +
            numberWithCommas((-delegated_steem).toFixed(3));
        const powerdown_balance_str = numberWithCommas(
            powerdown_steem.toFixed(3)
        );
        const sbd_balance_str = numberWithCommas('$' + sbd_balance.toFixed(3)); // formatDecimal(account.sbd_balance, 3)
        const sbd_orders_balance_str = numberWithCommas(
            '$' + sbdOrders.toFixed(3)
        );
        const savings_balance_str = numberWithCommas(
            saving_balance_steem.toFixed(3) + ' STEEM'
        );
        const savings_sbd_balance_str = numberWithCommas(
            '$' + sbd_balance_savings.toFixed(3)
        );

        const savings_menu = [
            {
                value: tt('userwallet_jsx.withdraw_LIQUID_TOKEN', {
                    LIQUID_TOKEN,
                }),
                link: '#',
                onClick: showTransfer.bind(this, 'STEEM', 'Savings Withdraw'),
            },
        ];
        const savings_sbd_menu = [
            {
                value: tt('userwallet_jsx.withdraw_DEBT_TOKENS', {
                    DEBT_TOKENS,
                }),
                link: '#',
                onClick: showTransfer.bind(this, 'SBD', 'Savings Withdraw'),
            },
        ];
        // set dynamic secondary wallet values
        const sbdInterest = this.props.sbd_interest / 100;
        const sbdMessage = (
            <span>{tt('userwallet_jsx.tradeable_tokens_transferred')}</span>
        );

        const reward_steem =
            parseFloat(account.get('reward_steem_balance').split(' ')[0]) > 0
                ? account.get('reward_steem_balance')
                : null;
        const reward_sbd =
            parseFloat(account.get('reward_sbd_balance').split(' ')[0]) > 0
                ? account.get('reward_sbd_balance')
                : null;
        const reward_sp =
            parseFloat(account.get('reward_vesting_steem').split(' ')[0]) > 0
                ? account.get('reward_vesting_steem').replace('STEEM', 'SP')
                : null;
        const rewards = [];
        if (reward_steem) rewards.push(reward_steem);
        if (reward_sbd) rewards.push(reward_sbd);
        if (reward_sp) rewards.push(reward_sp);
        let rewards_str;
        switch (rewards.length) {
            case 3:
                rewards_str = `${rewards[0]}, ${rewards[1]} and ${rewards[2]}`;
                break;
            case 2:
                rewards_str = `${rewards[0]} and ${rewards[1]}`;
                break;
            case 1:
                rewards_str = `${rewards[0]}`;
                break;
            default:
        }

        const combinedConversions = [
            ...(this.state.conversions || []).map(item => ({
                id: item.id,
                date: new Date(item.finishTime),
                amount: item.amount,
                requestid: item.requestid,
            })),
            ...(this.props.conversionsSuccess || [])
                .filter(item => {
                    const owner = item.get('owner');
                    const requestid = item.get('requestid');
                    if (owner !== account.get('name')) return false;
                    const alreadyExists = this.state.conversions.some(conv => conv.requestid === requestid);
                    return !alreadyExists;
                })
                .map(item => ({
                    id: item.get('requestid'),
                    date: new Date(item.get('timestamp') + 3.5 * 24 * 60 * 60 * 1000),
                    amount: parseFloat(item.get('amount').split(' ')[0]) || 0,
                    requestid: item.get('requestid'),
                }))
        ];

        let recoveryWarningBox, accountToRecover, recoveryAccount;
        try {
            const recoveryInfo = account.get('account_recovery');
            if (recoveryInfo && !hasClicked && currentUser && isMyAccount ) {
                const effectiveDate = new Date(recoveryInfo.get('effective_on'));
                const now = new Date();
                const daysLeft = Math.ceil((effectiveDate - now) / (1000 * 60 * 60 * 24));
                if (daysLeft > 0) {
                    accountToRecover = recoveryInfo.get('account_to_recover');
                    recoveryAccount = recoveryInfo.get('recovery_account');
                    const warningMessage = tt('change_recovery_account.recovery_warning', {
                        days: daysLeft,
                        day_label: daysLeft === 1 ? 'day' : 'days',
                        recovery_account: recoveryAccount,
                    });
                    recoveryWarningBox = (
                        <div className="row">
                            <div className="columns small-12">
                                <div className="UserWallet__warningbox">
                                    <span className="UserWallet__warningbox__text">
                                        {warningMessage}
                                    </span>
                                    <div className="UserWallet__warningbox__buttons">
                                        <button
                                            className="button"
                                            onClick={() => {
                                                this.setState({showChangeRecoveryModal: true})
                                            }}
                                        >
                                            {tt('change_recovery_account.take_action')}
                                        </button>
                                        <button
                                            className="button"
                                            onClick={() => {
                                                const userName = account.get('name');
                                                const storageKey = `button_click_${userName}`;
                                                const dataToStore = {
                                                  clicked: true,
                                                  timestamp: new Date().toISOString(),
                                                  recovery_account: recoveryAccount,
                                                };
                                                localStorage.setItem(storageKey, JSON.stringify(dataToStore));
                                                this.setState({
                                                  hasClicked: true,
                                                  timestamp: dataToStore.timestamp,
                                                });
                                            }}
                                        >
                                            {tt('g.dismiss')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                }
            }
        } catch (error) {
            console.warn('Error while processing account recovery info:', error);
        }

        let claimbox;
        if (currentUser && rewards_str && isMyAccount) {
            claimbox = (
                <div className="row">
                    <div className="columns small-12">
                        <div className="UserWallet__claimbox">
                            <span className="UserWallet__claimbox-text">
                                Your current rewards: {rewards_str}
                            </span>
                            <button
                                disabled={this.state.claimInProgress}
                                className="button"
                                onClick={e => {
                                    this.handleClaimRewards(account);
                                }}
                            >
                                {tt('userwallet_jsx.redeem_rewards')}
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        let spApr = 0;
        try {
            spApr = this.getCurrentApr(gprops);
        } catch (e) {
            console.error(e);
        }

        let advancedRoutesNotification = null;
        if (isMyAccount && withdraw_routes && withdraw_routes.size > 0) {
            const message =
                'Custom withdrawal routes were configured to receive vesting payments. Please reconfirm in the Advanced Routes options.';

            advancedRoutesNotification = (
                <div className="UserWallet__balance row">
                    <div className="column small-12">
                        <div className="callout success">
                            <p>{message}</p>
                        </div>
                    </div>
                </div>
            );
        }

        return (
            <div className="UserWallet">
                {(showChangeRecoveryModal && accountToRecover && recoveryAccount) && (
                    <ChangeRecoveryAccount
                        showChangeRecoveryModal={showChangeRecoveryModal}
                        hideChangeRecoveryModal={e => {
                            this.hideChangeRecoveryModal(false);
                        }}
                    />
                )}
                {recoveryWarningBox}
                {claimbox}
                <div className="row">
                    <div className="columns small-10 medium-12 medium-expand">
                        <WalletSubMenu
                            accountname={account.get('name')}
                            isMyAccount={isMyAccount}
                            showTab="balance"
                        />
                    </div>
                    <div className="columns shrink">
                        {isMyAccount && (
                            <button
                                className="UserWallet__buysp button hollow"
                                onClick={this.onShowSteemTradeTop}
                            >
                                {tt(
                                    'userwallet_jsx.buy_steem_or_steem_power'
                                )}
                            </button>
                        )}
                    </div>
                </div>
                <div className="UserWallet__balance row">
                    <div className="column small-12 medium-8">
                        STEEM
                        <FormattedHTMLMessage
                            className="secondary"
                            id="tips_js.liquid_token"
                            params={{ LIQUID_TOKEN, VESTING_TOKEN }}
                        />
                    </div>
                    <div className="column small-12 medium-4">
                        {isMyAccount ? (
                            <DropdownMenu
                                className="Wallet_dropdown"
                                items={steem_menu}
                                el="li"
                                selected={steem_balance_str + ' STEEM'}
                            />
                        ) : (
                            steem_balance_str + ' STEEM'
                        )}
                        {steemOrders ? (
                            <div
                                style={{
                                    paddingRight: isMyAccount
                                        ? '0.85rem'
                                        : null,
                                }}
                            >
                                <Link to="/market">
                                    <Tooltip t={tt('market_jsx.open_orders')}>
                                        (+{steem_orders_balance_str} STEEM)
                                    </Tooltip>
                                </Link>
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="UserWallet__balance row zebra">
                    <div className="column small-12 medium-8">
                        STEEM POWER
                        <FormattedHTMLMessage
                            className="secondary"
                            id="tips_js.influence_token"
                        />
                        {delegated_steem != 0 ? (
                            <span className="secondary">
                                {tt(
                                    'tips_js.part_of_your_steem_power_is_currently_delegated',
                                    { user_name: account.get('name') }
                                )}
                            </span>
                        ) : null}
                        {spApr && (
                            <FormattedHTMLMessage
                                className="secondary"
                                id="tips_js.steem_power_apr"
                                params={{ value: spApr.toFixed(2) }}
                            />
                        )}{' '}
                        {delegated_steem === 0 ? (
                            <span className="secondary">
                                {tt(
                                    'tips_js.your_steem_power_is_not_currently_delegated'
                                )}
                            </span>
                        ) : null}{' '}
                    </div>
                    <div className="column small-12 medium-4">
                        {isMyAccount ? (
                            <DropdownMenu
                                className="Wallet_dropdown"
                                items={power_menu}
                                el="li"
                                selected={power_balance_str + ' STEEM'}
                            />
                        ) : (
                            power_balance_str + ' STEEM'
                        )}
                        {delegated_steem != 0 ? (
                            <div
                                style={{
                                    paddingRight: isMyAccount
                                        ? '0.85rem'
                                        : null,
                                }}
                            >
                                <Tooltip t="STEEM POWER delegated to/from this account">
                                    ({received_power_balance_str} STEEM)
                                </Tooltip>
                            </div>
                        ) : null}
                    </div>
                </div>
                <div className="UserWallet__balance row">
                    <div className="column small-12 medium-8">
                        STEEM DOLLARS
                        <div className="secondary">
                            {sbdMessage}
                            <FormattedHTMLMessage
                                id="userwallet_jsx.convert_sbd_to_steem_info"
                            />
                        </div>
                    </div>
                    <div className="column small-12 medium-4">
                        {isMyAccount ? (
                            <DropdownMenu
                                className="Wallet_dropdown"
                                items={dollar_menu}
                                el="li"
                                selected={sbd_balance_str}
                            />
                        ) : (
                            sbd_balance_str
                        )}
                        {sbdOrders ? (
                            <div
                                style={{
                                    paddingRight: isMyAccount
                                        ? '0.85rem'
                                        : null,
                                }}
                            >
                                <Link to="/market">
                                    <Tooltip t={tt('market_jsx.open_orders')}>
                                        (+{sbd_orders_balance_str})
                                    </Tooltip>
                                </Link>
                            </div>
                        ) : null}
                        {combinedConversions.slice(0, 5).map(item => (
                            <div key={item.id}>
                                <Tooltip
                                    t={tt('userwallet_jsx.conversion_complete_tip', {
                                        date: item.date.toLocaleString(),
                                    })}
                                >
                                    <span>
                                        (+{tt('userwallet_jsx.in_conversion', {
                                            amount: numberWithCommas('$' + item.amount.toFixed(3)),
                                        })})
                                    </span>
                                </Tooltip>
                            </div>
                        ))}

                        {combinedConversions.length > 5 && (
                            <div
                                onClick={this.onShowAllConversions}
                                style={{
                                    cursor: 'pointer',
                                    color: '#1FBF8F',
                                    marginTop: '8px',
                                }}
                            >
                                View all pending conversions ({combinedConversions.length})
                            </div>
                        )}
                        <ConversionsModal
                            isOpen={this.state.showConversionsModal}
                            onClose={() => this.setState({ showConversionsModal: false })}
                            combinedConversions={combinedConversions}
                        />
                    </div>
                </div>
                <div className="UserWallet__balance row zebra">
                    <div className="column small-12 medium-8">
                        {tt('userwallet_jsx.savings')}
                        <div className="secondary">
                            <span>
                                {tt(
                                    'transfer_jsx.balance_subject_to_3_day_withdraw_waiting_period'
                                )}
                            </span>
                        </div>
                    </div>
                    <div className="column small-12 medium-4">
                        {isMyAccount ? (
                            <DropdownMenu
                                className="Wallet_dropdown"
                                items={savings_menu}
                                el="li"
                                selected={savings_balance_str}
                            />
                        ) : (
                            savings_balance_str
                        )}
                        <br />
                        {isMyAccount ? (
                            <DropdownMenu
                                className="Wallet_dropdown"
                                items={savings_sbd_menu}
                                el="li"
                                selected={savings_sbd_balance_str}
                            />
                        ) : (
                            savings_sbd_balance_str
                        )}
                    </div>
                </div>

                <div className="UserWallet__balance row">
                    <div className="column small-12 medium-8">
                        {tt('userwallet_jsx.estimated_account_value')}
                        <div className="secondary">
                            {tt('tips_js.estimated_value')}
                        </div>
                    </div>
                    <div className="column small-12 medium-4">
                        {estimate_output}
                    </div>
                </div>
                {advancedRoutesNotification}
                <div className="UserWallet__balance row zebra">
                    <div className="column small-12">
                        {powerdown_steem != 0 && (
                            <span>
                                {tt(
                                    'userwallet_jsx.next_power_down_is_scheduled_to_happen'
                                )}{' '}
                                <TimeAgoWrapper
                                    date={account.get(
                                        'next_vesting_withdrawal'
                                    )}
                                />{' '}
                                {'(~' + powerdown_balance_str + ' STEEM)'}.
                            </span>
                        )}
                    </div>
                </div>
                {disabledWarning && (
                    <div className="row">
                        <div className="column small-12">
                            <div className="callout warning">
                                {tt(
                                    'userwallet_jsx.transfers_are_temporary_disabled'
                                )}
                            </div>
                        </div>
                    </div>
                )}
                <div className="row">
                    <div className="column small-12">
                        <hr />
                    </div>
                </div>

                {isMyAccount && <SavingsWithdrawHistory />}

                {transfer_log && (
                    <div className="row">
                        <div className="column small-12">
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
                                <tbody>{transfer_log}</tbody>
                            </table>
                        </div>
                    </div>
                )}
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
        // This is current logined user.
        const currentUser = ownProps.currentUser;
        const withdraw_routes = state.user.get('withdraw_routes');

        return {
            ...ownProps,
            open_orders: state.market.get('open_orders'),
            price_per_steem,
            savings_withdraws,
            sbd_interest,
            gprops,
            trackingId: state.app.getIn(['trackingId'], null),
            currentUser,
            withdraw_routes,
            conversionsSuccess: state.transaction.get('conversions'),
            prices: state.transaction.get('prices'),
        };
    },
    // mapDispatchToProps
    dispatch => ({
        claimRewards: account => {
            const username = account.get('name');
            const successCallback = () => {
                dispatch(
                    globalActions.getState({ url: `@${username}/transfers` })
                );
            };

            const operation = {
                account: username,
                reward_steem: account.get('reward_steem_balance'),
                reward_sbd: account.get('reward_sbd_balance'),
                reward_vests: account.get('reward_vesting_balance'),
            };

            dispatch(
                transactionActions.broadcastOperation({
                    type: 'claim_reward_balance',
                    operation,
                    successCallback,
                    errorCallback: err => {
                        console.error('claim reward balance error:', err);
                    },
                })
            );
        },
        convertToSteem: e => {
            e.preventDefault();
            const name = 'convertToSteem';
            dispatch(globalActions.showDialog({ name }));
        },
        updatePrices: () => dispatch(transactionActions.updatePrices()),
        notify: message => {
            dispatch(
                appActions.addNotification({
                    key: 'chpwd_' + Date.now(),
                    message,
                    dismissAfter: 3000,
                })
            );
        },
    })
)(UserWallet);
