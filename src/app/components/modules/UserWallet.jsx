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
    pricePerTRX,
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
import { recordAdsView } from 'app/utils/ServerApiClient';
import QRCode from 'react-qr';

const assetPrecision = 1000;

class UserWallet extends React.Component {
    constructor() {
        super();
        this.state = {
            claimInProgress: false,
            showQRButton: true,
            showQR: false,
            copied: false,
        };
        this.onShowDepositSteem = e => {
            if (e && e.preventDefault) e.preventDefault();
            // const name = this.props.currentUser.get('username');
            const new_window = window.open();
            new_window.opener = null;
            new_window.location = 'https://poloniex.com/exchange#trx_steem';
        };
        this.onShowWithdrawSteem = e => {
            e.preventDefault();
            const new_window = window.open();
            new_window.opener = null;
            new_window.location = 'https://poloniex.com/exchange#trx_steem';
        };
        this.onShowDepositPower = (currentUserName, e) => {
            // this function will not be called since power menu comment
            e.preventDefault();
            const new_window = window.open();
            new_window.opener = null;
            new_window.location =
                'https://blocktrades.us/?input_coin_type=eth&output_coin_type=steem_power&receive_address=' +
                currentUserName;
        };
        this.onShowDepositSBD = (currentUserName, e) => {
            e.preventDefault();
            const new_window = window.open();
            new_window.opener = null;
            new_window.location =
                'https://global.bittrex.com/Market/Index?MarketName=BTC-SBD';
        };
        this.onShowWithdrawSBD = e => {
            e.preventDefault();
            const new_window = window.open();
            new_window.opener = null;
            new_window.location =
                'https://global.bittrex.com/Market/Index?MarketName=BTC-SBD';
        };
        this.onShowTRX = e => {
            e.preventDefault();
            const new_window = window.open();
            new_window.opener = null;
            new_window.location = 'https://poloniex.com/exchange#usdt_trx';
        };
        this.onShowTRXTransaction = (trx_address, e) => {
            e.preventDefault();
            recordAdsView({
                trackingId: this.props.trackingId,
                adTag: 'TronHistory',
            });
            const new_window = window.open();
            new_window.opener = null;
            if ($STM_Config.tron_host.includes('shasta')) {
                new_window.location =
                    'https://shasta.tronscan.org/#/address/' +
                    trx_address +
                    '/transactions';
            } else {
                new_window.location =
                    'https://tronscan.org/#/address/' +
                    trx_address +
                    '/transactions';
            }
        };
        // see tron vote component
        // this.onShowTRXVote = (trx_address, e) => {
        //     e.preventDefault();
        //     recordAdsView({
        //         trackingId: this.props.trackingId,
        //         adTag: 'TronVote',
        //     });
        //     const new_window = window.open();
        //     new_window.opener = null;
        //     new_window.location = '';
        // };
        this.onShowJUST = e => {
            e.preventDefault();
            recordAdsView({
                trackingId: this.props.trackingId,
                adTag: 'StakingByJust',
            });
            const new_window = window.open();
            new_window.opener = null;
            new_window.location =
                'https://just.tronscan.org/?lang=en-US#/login';
        };
        this.showQR = e => {
            this.setState({ showQR: true, showQRButton: false });
        };
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'UserWallet');
    }

    handleClaimRewards = (account, tron_address) => {
        this.setState({ claimInProgress: true }); // disable the claim button
        this.props.claimRewards(account, tron_address);
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

    render() {
        const {
            onShowDepositSteem,
            onShowWithdrawSteem,
            onShowDepositSBD,
            onShowWithdrawSBD,
            onShowDepositPower,
            onShowTRX,
            onShowTRXTransaction,
            onShowJUST,
        } = this;
        const {
            convertToSteem,
            price_per_steem,
            price_per_trx,
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

        const showTronTransfer = (asset, transferType, e) => {
            e.preventDefault();
            this.props.showTransfer({
                to: isMyAccount ? null : account.get('name'),
                asset,
                transferType,
            });
            // this.props.showTronTransfer({
            //     to: isMyAccount ? null : account.get('name'),
            //     asset,
            //     transferType,
            // });
        };

        const onCreateTronAccount = e => {
            this.props.showTronCreate();
        };
        const onUpdateTronAccount = e => {
            this.props.showUpdate();
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

        // Sum conversions
        let conversionValue = 0;
        const currentTime = new Date().getTime();
        const conversions = account
            .get('other_history', List())
            .reduce((out, item) => {
                if (item.getIn([1, 'op', 0], '') !== 'convert') return out;

                const timestamp = new Date(
                    item.getIn([1, 'timestamp'])
                ).getTime();
                const finishTime = timestamp + 86400000 * 3.5; // add 3.5day conversion delay
                if (finishTime < currentTime) return out;

                const amount = parseFloat(
                    item.getIn([1, 'op', 1, 'amount']).replace(' SBD', '')
                );
                conversionValue += amount;

                return out.concat([
                    <div key={item.get(0)}>
                        <Tooltip
                            t={tt('userwallet_jsx.conversion_complete_tip', {
                                date: new Date(finishTime).toLocaleString(),
                            })}
                        >
                            <span>
                                (+{tt('userwallet_jsx.in_conversion', {
                                    amount: numberWithCommas(
                                        '$' + amount.toFixed(3)
                                    ),
                                })})
                            </span>
                        </Tooltip>
                    </div>,
                ]);
            }, []);

        const balance_steem = parseFloat(account.get('balance').split(' ')[0]);
        const saving_balance_steem = parseFloat(savings_balance.split(' ')[0]);
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
        // const tron_reward =  (currentUser && currentUser.has('tron_reward'))
        //                     ?currentUser.get('tron_reward'):'0.000';
        const tron_reward =
            typeof this.props.tron_reward == String
                ? this.props.tron_reward.replace(/[^0-9.]/, '')
                : 0.0;
        const tron_balance = parseFloat(this.props.tron_balance);

        // set displayed estimated value
        const total_sbd =
            sbd_balance +
            sbd_balance_savings +
            savings_sbd_pending +
            sbdOrders +
            conversionValue;
        const total_steem =
            vesting_steem +
            balance_steem +
            saving_balance_steem +
            savings_pending +
            steemOrders;
        const total_trx = parseFloat(tron_balance + tron_reward);
        const total_value =
            '$' +
            numberWithCommas(
                (
                    total_steem * price_per_steem +
                    total_sbd +
                    total_trx * price_per_trx
                ).toFixed(2)
            );
        // console.log(total_trx * price_per_trx);
        // format spacing on estimated value based on account state
        let estimate_output = <p>{total_value}</p>;
        if (isMyAccount) {
            estimate_output = <p>{total_value}&nbsp; &nbsp; &nbsp;</p>;
        }

        /// transfer log
        let idx = 0;
        const transfer_log = account
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
                value: tt('userwallet_jsx.power_down'),
                link: '#',
                onClick: powerDown.bind(this, false),
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
            { value: tt('userwallet_jsx.market'), link: '/market' },
        ];
        const trx_menu = [
            {
                value: tt('g.sell'),
                link: '#',
                onClick: onShowTRX,
            },
            {
                value: tt('g.buy'),
                link: '#',
                onClick: onShowTRX,
            },
            {
                value: tt('g.tronVote'),
                link: '#',
                onClick: e => {
                    e.preventDefault();
                    recordAdsView({
                        trackingId: this.props.trackingId,
                        adTag: 'TronVote',
                    });
                    this.props.showVote();
                },
            },
            {
                value: tt('userwallet_jsx.just_mortgage'),
                link: '#',
                onClick: onShowJUST,
            },
        ];
        if (this.props.pass_auth && this.props.tron_address != '') {
            trx_menu.push({
                value: tt('g.transfer'),
                link: '#',
                // todo  replace with TRX function
                onClick: showTronTransfer.bind(
                    this,
                    'TRX',
                    'Transfer to Account'
                ),
            });
        }
        if (isMyAccount) {
            steem_menu.push({
                value: tt('g.buy'),
                link: '#',
                onClick: onShowDepositSteem.bind(
                    this,
                    currentUser.get('username')
                ),
            });
            steem_menu.push({
                value: tt('g.sell'),
                link: '#',
                onClick: onShowWithdrawSteem,
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
                value: tt('g.buy'),
                link: '#',
                onClick: onShowDepositSBD.bind(
                    this,
                    currentUser.get('username')
                ),
            });
            dollar_menu.push({
                value: tt('g.sell'),
                link: '#',
                onClick: onShowWithdrawSBD,
            });
        }

        const isTrxAccount = this.props.tron_user;
        const TRX_address = this.props.tron_address;

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

        const trx_balance_str = numberWithCommas(tron_balance.toFixed(3));

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
        const reward_tron =
            typeof this.props.tron_reward == String
                ? parseFloat(this.props.tron_reward.split(' ')[0]) > 0
                    ? this.props.tron_reward
                    : null
                : null;
        const rewards = [];
        if (reward_steem) rewards.push(reward_steem);
        if (reward_sbd) rewards.push(reward_sbd);
        if (reward_sp) rewards.push(reward_sp);
        if (reward_tron) rewards.push(reward_tron);
        let rewards_str;
        switch (rewards.length) {
            case 4:
                rewards_str = `${rewards[0]}, ${rewards[1]} , ${
                    rewards[2]
                } and ${rewards[3]}`;
                break;
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
                                    this.handleClaimRewards(
                                        account,
                                        TRX_address
                                    );
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

        return (
            <div className="UserWallet">
                {claimbox}
                <div className="row">
                    <div className="columns small-10 medium-12 medium-expand">
                        <WalletSubMenu
                            accountname={account.get('name')}
                            isMyAccount={isMyAccount}
                            showTab="balance"
                        />
                    </div>
                    {
                        <div className="columns shrink">
                            {isMyAccount && (
                                <button
                                    className="UserWallet__buysp button hollow"
                                    onClick={this.onShowDepositSteem}
                                >
                                    {tt(
                                        'userwallet_jsx.buy_steem_or_steem_power'
                                    )}
                                </button>
                            )}
                        </div>
                    }
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
                        <div className="secondary">{sbdMessage}</div>
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
                        {conversions}
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
                        TRX
                        <div className="secondary">
                            {!isTrxAccount
                                ? tt('userwallet_jsx.create_trx_description')
                                : TRX_address}
                            <CopyToClipboard
                                text={TRX_address}
                                onCopy={() => {
                                    this.setState({ copied: true });
                                    setTimeout(() => {
                                        this.setState({ copied: false });
                                    }, 2000);
                                }}
                            >
                                <button className="buttonQR">
                                    {tt('tron_jsx.copy')}
                                </button>
                            </CopyToClipboard>
                            {this.state.copied ? (
                                <span style={{ color: 'red' }}>
                                    Copy successfully
                                </span>
                            ) : null}
                            {this.state.showQRButton && (
                                <button
                                    className="buttonQR"
                                    onClick={() =>
                                        this.setState({
                                            showQR: true,
                                            showQRButton: false,
                                            copied: false,
                                        })
                                    }
                                >
                                    {tt('tron_jsx.qr_code')}{' '}
                                </button>
                            )}
                            {this.state.showQR && (
                                <Link
                                    className="link"
                                    onClick={() =>
                                        this.setState({
                                            showQR: false,
                                            showQRButton: true,
                                            copied: false,
                                        })
                                    }
                                >
                                    <QRCode text={TRX_address} />{' '}
                                </Link>
                            )}
                            <br />
                            {tt('userwallet_jsx.trx_description')}
                        </div>
                    </div>
                    {/* <div className="column small-12 medium-2"> ..</div> */}
                    <div className="column small-12 medium-4">
                        {isMyAccount && isTrxAccount ? (
                            <DropdownMenu
                                className="Wallet_dropdown"
                                items={trx_menu}
                                el="li"
                                selected={trx_balance_str + ' TRX'}
                            />
                        ) : (
                            trx_balance_str + ' TRX'
                        )}

                        {
                            <div className="columns shrink">
                                {this.props.pass_auth &&
                                    isMyAccount &&
                                    !isTrxAccount && (
                                        <button
                                            className="UserWallet__buysp button buttonSmall hollow"
                                            onClick={onCreateTronAccount.bind(
                                                this
                                            )}
                                        >
                                            {tt(
                                                'userwallet_jsx.create_trx_button'
                                            )}
                                        </button>
                                    )}
                            </div>
                        }
                        {
                            <div className="columns shrink">
                                {this.props.pass_auth &&
                                    isMyAccount &&
                                    isTrxAccount && (
                                        <button
                                            className="UserWallet__buysp button buttonSmall hollow"
                                            onClick={onUpdateTronAccount.bind(
                                                this
                                            )}
                                        >
                                            {tt(
                                                'userwallet_jsx.update_trx_button'
                                            )}
                                        </button>
                                    )}
                            </div>
                        }
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
                <div className="UserWallet__balance row">
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

                <div className="row">
                    <div className="column small-12">
                        {/** history */}
                        <h4>
                            {tt('userwallet_jsx.history')}
                            <Link
                                className="link"
                                onClick={onShowTRXTransaction.bind(
                                    this,
                                    TRX_address
                                )}
                            >
                                {tt('tron_jsx.tron_tx_history')}
                            </Link>
                        </h4>
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
            </div>
        );
    }
}

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const price_per_steem = pricePerSteem(state);
        const price_per_trx = pricePerTRX(state);
        const savings_withdraws = state.user.get('savings_withdraws');
        const gprops = state.global.get('props');
        const sbd_interest = gprops.get('sbd_interest_rate');
        const currentUser = state.user.get('current');
        const tron_reward =
            currentUser && currentUser.has('tron_reward')
                ? currentUser.get('tron_reward')
                : '0.000 TRX';
        const tron_user =
            currentUser && currentUser.has('tron_user')
                ? currentUser.get('tron_user')
                : false;
        const tron_address =
            currentUser && currentUser.has('tron_address')
                ? currentUser.get('tron_address')
                : '';
        const tron_balance =
            currentUser && currentUser.has('tron_balance')
                ? currentUser.get('tron_balance')
                : 0.0;
        const pass_auth =
            currentUser && currentUser.has('pass_auth')
                ? currentUser.get('pass_auth')
                : false;
        console.log(tron_reward);
        return {
            ...ownProps,
            open_orders: state.market.get('open_orders'),
            price_per_steem,
            price_per_trx,
            savings_withdraws,
            sbd_interest,
            gprops,
            tron_reward,
            tron_user,
            tron_address,
            tron_balance,
            pass_auth,
            trackingId: state.app.getIn(['trackingId'], null),
        };
    },
    // mapDispatchToProps
    dispatch => ({
        claimRewards: (account, tron_address) => {
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
                })
            );
            dispatch(
                userActions.updateUser({
                    claim_reward: true,
                    tron_address,
                })
            );
            setTimeout(() => {
                dispatch(userActions.usernamePasswordLogin(username));
            }, 2000); // wait 2 second to refresh tron data
        },
        convertToSteem: e => {
            //post 2018-01-31 if no calls to this function exist may be safe to remove. Investigate use of ConvertToSteem.jsx
            e.preventDefault();
            const name = 'convertToSteem';
            dispatch(globalActions.showDialog({ name }));
        },
        showUpdate: e => {
            if (e) e.preventDefault();
            dispatch(userActions.showUpdate());
            // dispatch(userActions.showTronCreate());
        },
        showTronCreate: e => {
            if (e) e.preventDefault();
            dispatch(userActions.showTronCreate());
        },
        updateUser: () => {
            dispatch(
                userActions.updateUser({
                    claim_reward: false,
                    tron_address: '',
                })
            );
        },
    })
)(UserWallet);
