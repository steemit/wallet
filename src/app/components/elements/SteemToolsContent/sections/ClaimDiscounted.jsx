import React from 'react';
import { connect } from 'react-redux';
import tt from 'counterpart';
import { api } from '@steemit/steem-js';
import { FormattedHTMLMessage } from 'app/Translator';
import { numberWithCommas } from 'app/utils/StateFunctions';

import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import Icon from 'app/components/elements/Icon';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as userActions from 'app/redux/UserReducer';
import * as appActions from 'app/redux/AppReducer';
import ConfirmClaimAct from './ConfirmClaimAct';

let STEEM_RC_REGEN_TIME = 60 * 60 * 24 * 5; // 5 days
let STEEM_BLOCK_INTERVAL = 3;
let STEEM_NUM_RESOURCE_TYPES = 5;

let RESOURCE_HISTORY_BYTES = 0;
let RESOURCE_NEW_ACCOUNTS = 1;
let RESOURCE_MARKET_BYTES = 2;
let RESOURCE_STATE_BYTES = 3;
let RESOURCE_EXECUTION_TIME = 4;

let RESOURCE_NAMES = [
    'resource_history_bytes',
    'resource_new_accounts',
    'resource_market_bytes',
    'resource_state_bytes',
    'resource_execution_time',
];

function computeRcCostOfResource(curveParams, currentPool, resourceCount, rcRegen) {
    if (resourceCount <= BigInt(0)) return BigInt(0);

    let coeffA = BigInt(curveParams.coeff_a);
    let coeffB = BigInt(curveParams.coeff_b);
    let shift = BigInt(curveParams.shift);

    let num = rcRegen * coeffA;
    num = num >> shift;
    num = num + BigInt(1);
    num = num * resourceCount;

    let denom = coeffB;
    if (currentPool > BigInt(0)) denom = denom + currentPool;

    let result = num / denom;
    return result + BigInt(1);
}

function regenerateMana(currentMana, lastUpdateTime, maxMana, nowSec) {
    let maxManaBig = BigInt(maxMana);
    let manaBig = BigInt(currentMana);

    let elapsed = nowSec - Number(lastUpdateTime);
    if (elapsed <= 0) return manaBig;

    let regenAmount =
        (maxManaBig * BigInt(elapsed)) / BigInt(STEEM_RC_REGEN_TIME);
    manaBig = manaBig + regenAmount;

    if (manaBig > maxManaBig) manaBig = maxManaBig;
    return manaBig;
}

function getClaimAccountResourceUsage(sizeInfo) {
    let TX_SIZE = BigInt(120);

    let txObjBase =
        sizeInfo && sizeInfo.transaction_object_base_size
            ? BigInt(sizeInfo.transaction_object_base_size)
            : BigInt(35) * BigInt(174);

    let txObjByte =
        sizeInfo && sizeInfo.transaction_object_byte_size
            ? BigInt(sizeInfo.transaction_object_byte_size)
            : BigInt(174);

    let resourceCount = new Array(STEEM_NUM_RESOURCE_TYPES);
    for (let i = 0; i < resourceCount.length; i++) resourceCount[i] = BigInt(0);

    resourceCount[RESOURCE_HISTORY_BYTES] = TX_SIZE;
    resourceCount[RESOURCE_NEW_ACCOUNTS] = BigInt(1);
    resourceCount[RESOURCE_MARKET_BYTES] = BigInt(0);
    resourceCount[RESOURCE_STATE_BYTES] = txObjBase + txObjByte * TX_SIZE;
    resourceCount[RESOURCE_EXECUTION_TIME] = BigInt(10000);

    return resourceCount;
}

function computeClaimAccountCost(resourceParams, resourcePool, rcRegen, sizeInfo) {
    let resourceUsage = getClaimAccountResourceUsage(sizeInfo);
    let totalCost = BigInt(0);

    for (let i = 0; i < STEEM_NUM_RESOURCE_TYPES; i++) {
        let name = RESOURCE_NAMES[i];
        let params = resourceParams ? resourceParams[name] : null;
        let poolObj = resourcePool ? resourcePool[name] : null;

        if (!params || !poolObj) continue;

        let resourceDynamicsParams = params.resource_dynamics_params;
        let resourceUnit =
            resourceDynamicsParams && resourceDynamicsParams.resource_unit
                ? BigInt(resourceDynamicsParams.resource_unit)
                : BigInt(1);

        let pool =
            poolObj && poolObj.pool !== undefined ? BigInt(poolObj.pool) : BigInt(0);
        let curveParams = params.price_curve_params;

        let scaledUsage = resourceUsage[i] * resourceUnit;

        let c =
            rcRegen > BigInt(0)
                ? computeRcCostOfResource(curveParams, pool, scaledUsage, rcRegen)
                : BigInt(0);

        totalCost = totalCost + c;
    }

    return totalCost;
}

function isInvalidErrorValue(value) {
    if (
        value === false ||
        value === 0 ||
        value === null ||
        value === undefined
    ) {
        return true;
    }

    let text = '';

    if (typeof value === 'string') {
        text = value;
    } else if (value instanceof Error) {
        text = value.message || String(value);
    } else {
        try {
            text = String(value);
        } catch (e) {
            return true;
        }
    }

    let normalized = text.trim().toLowerCase();

    if (!normalized) return true;
    if (normalized === '0') return true;
    if (normalized === 'false') return true;
    if (normalized === 'null') return true;
    if (normalized === 'undefined') return true;
    if (normalized.includes('undefined')) return true;

    return false;
}

function normalizeErrorMessage(value, fallback = tt('g.error')) {
    if (isInvalidErrorValue(value)) {
        return fallback;
    }

    if (typeof value === 'string') {
        return value.trim();
    }

    if (value instanceof Error) {
        let msg = (value.message || String(value) || '').trim();
        return isInvalidErrorValue(msg) ? fallback : msg;
    }

    try {
        let msg = String(value).trim();
        return isInvalidErrorValue(msg) ? fallback : msg;
    } catch (e) {
        return fallback;
    }
}

class ClaimDiscounted extends React.Component {
    constructor(props) {
        super(props);
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'ClaimDiscounted');

        this.state = {
            loading: false,
            error: null,

            username: props.username || '',
            claimedAct: 0,
            steemBalance: 0,
            steemPerAct: props.steemPerActRaw || '3.000 STEEM',

            rcCurrent: BigInt(0),
            rcMax: BigInt(0),
            rcPerAct: BigInt(0),

            claimableByRc: 0,
            claimableBySteem: 0,

            payment: 'RC',
            claimAmount: 1,
        };

        this.MAX_CLAIM_AMOUNT = 600;
    }

    componentDidMount() {
        this.refresh();
    }

    componentDidUpdate(prevProps) {
        if (prevProps.username !== this.props.username) {
            let nextUsername = this.props.username || '';
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({ username: nextUsername }, () => this.refresh());
        }
        if (
            prevProps.pending_claimed_accounts !== this.props.pending_claimed_accounts ||
            prevProps.balance !== this.props.balance ||
            prevProps.totalVestingShares !== this.props.totalVestingShares ||
            prevProps.steemPerActRaw !== this.props.steemPerActRaw ||
            prevProps.steemPerActNum !== this.props.steemPerActNum
        ) {
            this.refresh();
        }
    }

    async refresh() {
        let username = this.props.accountname || this.state.username;
        if (!username) return;

        this.setState({ loading: true, error: null });
        try {
            let calls = await Promise.all([
                api.callAsync('rc_api.find_rc_accounts', { accounts: [username] }),
                api.callAsync('rc_api.get_resource_params', {}),
                api.callAsync('rc_api.get_resource_pool', {}),
            ]);

            let rcAccRes = calls[0];
            let resParamsRes = calls[1];
            let resPoolRes = calls[2];

            let claimedAct = Number(this.props.pending_claimed_accounts || 0);
            let steemBalance = parseFloat(String(this.props.balance || '0.000')) || 0;
            let steemPerActRaw = this.props.steemPerActRaw || '3.000 STEEM';

            let totalVestingSharesRaw = String(this.props.totalVestingShares || '0.00');
            let totalVestingShares = BigInt(totalVestingSharesRaw.replace('.', ''));

            let rcRegenDivisor = BigInt(STEEM_RC_REGEN_TIME / STEEM_BLOCK_INTERVAL);
            let rcRegen =
                rcRegenDivisor > BigInt(0) ? totalVestingShares / rcRegenDivisor : BigInt(0);

            let rcAcc =
                rcAccRes && rcAccRes.rc_accounts && rcAccRes.rc_accounts.length
                    ? rcAccRes.rc_accounts[0]
                    : null;

            let nowSec = Math.floor(Date.now() / 1000);

            let rcCurrent = rcAcc
                ? regenerateMana(
                      rcAcc.rc_manabar.current_mana,
                      rcAcc.rc_manabar.last_update_time,
                      rcAcc.max_rc,
                      nowSec
                  )
                : BigInt(0);

            let rcMax = rcAcc ? BigInt(rcAcc.max_rc) : BigInt(0);

            let resourceParams =
                resParamsRes && resParamsRes.resource_params ? resParamsRes.resource_params : {};
            let resourcePool =
                resPoolRes && resPoolRes.resource_pool ? resPoolRes.resource_pool : {};

            let sizeInfo =
                resParamsRes && resParamsRes.size_info && resParamsRes.size_info.resource_state_bytes
                    ? resParamsRes.size_info.resource_state_bytes
                    : null;

            let rcPerAct = computeClaimAccountCost(resourceParams, resourcePool, rcRegen, sizeInfo);

            let claimableByRc = rcPerAct > BigInt(0) ? Number(rcCurrent / rcPerAct) : 0;

            let steemPerActNum = Number(this.props.steemPerActNum || 3);
            let claimableBySteem = steemPerActNum > 0 ? Math.floor(steemBalance / steemPerActNum) : 0;

            let payment = this.state.payment;
            let maxClaimable = payment === 'RC' ? claimableByRc : claimableBySteem;
            let maxAllowed = Math.min(maxClaimable, this.MAX_CLAIM_AMOUNT);

            let nextClaimAmount = this.state.claimAmount || 1;
            if (nextClaimAmount > Math.max(maxAllowed, 1)) nextClaimAmount = Math.max(maxAllowed, 1);
            if (nextClaimAmount < 1) nextClaimAmount = 1;

            this.setState({
                claimedAct: claimedAct,
                steemBalance: steemBalance,
                steemPerAct: steemPerActRaw,

                rcCurrent: rcCurrent,
                rcMax: rcMax,
                rcPerAct: rcPerAct,

                claimableByRc: claimableByRc,
                claimableBySteem: claimableBySteem,

                claimAmount: nextClaimAmount,
                loading: false,
            });
        } catch (e) {
            console.error('ClaimDiscounted.refresh', e);
            this.setState({
                loading: false,
                error: normalizeErrorMessage(
                    e,
                    tt('steem_tools.claim_act.unexpected_error')
                ),
            });
        }
    }

    onChangePayment = (e) => {
        let payment = e.target.value;
        let maxClaimable = payment === 'RC' ? this.state.claimableByRc : this.state.claimableBySteem;
        let maxAllowed = Math.min(maxClaimable, this.MAX_CLAIM_AMOUNT);

        let nextClaimAmount = this.state.claimAmount || 1;
        if (nextClaimAmount > Math.max(maxAllowed, 1)) nextClaimAmount = Math.max(maxAllowed, 1);
        if (nextClaimAmount < 1) nextClaimAmount = 1;

        this.setState({ payment: payment, claimAmount: nextClaimAmount });
    };

    onChangeClaimAmount = (e) => {
        let v = Number(e.target.value);
        let maxClaimable =
            this.state.payment === 'RC' ? this.state.claimableByRc : this.state.claimableBySteem;
        let maxAllowed = Math.min(maxClaimable, this.MAX_CLAIM_AMOUNT);

        let safe = Number.isFinite(v) ? v : 1;
        let next = safe;
        if (next < 1) next = 1;
        if (next > Math.max(maxAllowed, 1)) next = Math.max(maxAllowed, 1);

        this.setState({ claimAmount: next });
    };

    onClaim = () => {
        let username = this.state.username;
        if (!this.props.isLoggedIn || !username) {
            this.setState({ error: tt('steem_tools.claim_act.login_required') });
            return;
        }

        let payment = this.state.payment;
        let claimAmount = this.state.claimAmount;

        let claimable = payment === 'RC' ? this.state.claimableByRc : this.state.claimableBySteem;
        let maxAllowed = Math.min(claimable, this.MAX_CLAIM_AMOUNT);

        if (claimAmount < 1 || claimAmount > maxAllowed) {
            this.setState({ error: tt('steem_tools.claim_act.invalid_amount') });
            return;
        }

        let fee = payment === 'RC' ? '0.000 STEEM' : this.props.steemPerActRaw;

        this.setState({ loading: true, error: null });

        this.props.claimAct({
            creator: username,
            fee,
            payment,
            claimAmount,
            claimable,
            rcPerAct: this.state.rcPerAct,
            steemPerAct: this.state.steemPerAct,
            optimisticUpdate: () => {
                let nextClaimed = Number(this.state.claimedAct || 0) + Number(claimAmount || 0);

                let nextRcCurrent = this.state.rcCurrent;
                let nextSteemBalance = this.state.steemBalance;

                if (payment === 'RC') {
                    let spent = BigInt(0);
                    try {
                        spent = BigInt(this.state.rcPerAct || BigInt(0)) * BigInt(Number(claimAmount || 0));
                    } catch (e) {
                        spent = BigInt(0);
                    }
                    nextRcCurrent = nextRcCurrent > spent ? nextRcCurrent - spent : BigInt(0);
                } else {
                    let steemPerActNum = Number(this.props.steemPerActNum || 3);
                    let spentSteem = steemPerActNum * Number(claimAmount || 0);
                    nextSteemBalance = Math.max(0, Number(nextSteemBalance || 0) - spentSteem);
                }

                let nextClaimableByRc =
                    this.state.rcPerAct > BigInt(0) ? Number(nextRcCurrent / this.state.rcPerAct) : 0;

                let steemPerActNum2 = Number(this.props.steemPerActNum || 3);
                let nextClaimableBySteem =
                    steemPerActNum2 > 0 ? Math.floor(nextSteemBalance / steemPerActNum2) : 0;

                let nextMaxClaimable =
                    payment === 'RC' ? nextClaimableByRc : nextClaimableBySteem;
                let nextMaxAllowed = Math.min(nextMaxClaimable, this.MAX_CLAIM_AMOUNT);

                let nextClaimAmount = this.state.claimAmount || 1;
                if (nextClaimAmount > Math.max(nextMaxAllowed, 1))
                    nextClaimAmount = Math.max(nextMaxAllowed, 1);
                if (nextClaimAmount < 1) nextClaimAmount = 1;

                this.setState({
                    claimedAct: nextClaimed,
                    rcCurrent: nextRcCurrent,
                    steemBalance: nextSteemBalance,
                    claimableByRc: nextClaimableByRc,
                    claimableBySteem: nextClaimableBySteem,
                    claimAmount: nextClaimAmount,
                });
            },
            successCallback: () => {
                this.setState({ loading: false });
            },
            errorCallback: (err) => {
                this.setState({
                    loading: false,
                    error: normalizeErrorMessage(
                        err,
                        tt('steem_tools.claim_act.unexpected_error')
                    ),
                });
            },
        });
    };

    render() {
        let loading = this.state.loading;
        let rawError = this.state.error;
        let error = isInvalidErrorValue(rawError)
            ? null
            : normalizeErrorMessage(
                  rawError,
                  tt('steem_tools.claim_act.unexpected_error')
              );

        let username = this.state.username || this.props.accountname;
        let claimedAct = this.state.claimedAct;

        let payment = this.state.payment;
        let claimAmount = this.state.claimAmount;

        let claimableByRc = this.state.claimableByRc;
        let claimableBySteem = this.state.claimableBySteem;

        let steemPerAct = this.state.steemPerAct;
        let rcPerAct = this.state.rcPerAct;

        let claimable = payment === 'RC' ? claimableByRc : claimableBySteem;
        let maxAllowed = Math.min(claimable, this.MAX_CLAIM_AMOUNT);

        let tooltipRc = tt('steem_tools.claim_act.claimable_rc_tooltip', {rc_per_act: numberWithCommas(String(rcPerAct))})
        let tooltipSteem = tt('steem_tools.claim_act.claimable_steem_tooltip', {steem_per_act: String(steemPerAct)})

        let canClaim =
            Boolean(this.props.isLoggedIn) &&
            !loading &&
            Number.isFinite(Number(claimAmount)) &&
            Number(claimAmount) >= 1 &&
            Number(claimAmount) <= Number(maxAllowed);

        return (
            <div>
                <div className="advtools-panel">
                    <div className="row">
                        <h3 className="column">{tt('steem_tools.claim_act.title')}</h3>
                    </div>

                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="steem_tools.claim_act.description"
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ marginTop: 14 }}>
                        {loading ? (
                            <div className="row">
                                <div className="column">
                                    <LoadingIndicator type="circle" />
                                </div>
                            </div>
                        ) : (
                            <div>
                                <div className="row row-column-mobile">
                                    <div className="column flex-container-1 flex-mobile-full" style={{ paddingTop: 5 }}>
                                        <div className="label-with-tooltip">
                                            <div>{tt('steem_tools.claim_act.account')}</div>
                                        </div>
                                    </div>

                                    <div className="column flex-container-2 flex-mobile-full">
                                        <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                            <span className="input-group-label">@</span>
                                            <input
                                                className="input-group-field bold"
                                                type="text"
                                                disabled
                                                value={username || ''}
                                            />
                                        </div>
                                    </div>
                                </div>

                                <div className="row row-column-mobile">
                                    <div className="column flex-container-1 flex-mobile-full" style={{ paddingTop: 5 }}>
                                        {tt('steem_tools.claim_act.claimed')}
                                    </div>

                                    <div className="column flex-container-2 flex-mobile-full">
                                        <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                            <input
                                                className="input-group-field bold"
                                                type="text"
                                                disabled
                                                value={numberWithCommas(String(claimedAct))}
                                            />
                                            <span className="input-group-label">
                                                {tt('steem_tools.claim_act.act_suffix')}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className="row row-column-mobile">
                                    <div className="column flex-container-1 flex-mobile-full" style={{ paddingTop: 5 }}>
                                        <div className="label-with-tooltip">
                                            <div>{tt('steem_tools.claim_act.claimable')}</div>
                                        </div>
                                    </div>

                                    <div className="column flex-container-2 flex-mobile-full">
                                        <div className="advtools-grid-2 grid-column-mobile">
                                            <div>
                                                <div className="label-with-tooltip" style={{ marginBottom: 6 }}>
                                                    <div style={{ margin: 'auto 0', fontSize: 12, opacity: 0.8 }}>{tt('steem_tools.claim_act.based_on_rc')}</div>
                                                    <div className="info-hover-container">
                                                        <Icon name="info" className="info" />
                                                        <span className="info-msg">{tooltipRc}</span>
                                                    </div>
                                                </div>

                                                <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                                    <input
                                                        className="input-group-field bold"
                                                        type="text"
                                                        disabled
                                                        value={numberWithCommas(String(claimableByRc))}
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <div className="label-with-tooltip" style={{ marginBottom: 6 }}>
                                                    <div style={{ marginTop: "auto a", fontSize: 12, opacity: 0.8 }}>{tt('steem_tools.claim_act.based_on_steem')}</div>
                                                    <div className="info-hover-container">
                                                        <Icon name="info" className="info" />
                                                        <span className="info-msg">{tooltipSteem}</span>
                                                    </div>
                                                </div>

                                                <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                                    <input
                                                        className="input-group-field bold"
                                                        type="text"
                                                        disabled
                                                        value={numberWithCommas(String(claimableBySteem))}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div className="row row-column-mobile">
                                    <div className="column flex-container-1 flex-mobile-full" style={{ paddingTop: 5 }}>
                                        <div className="label-with-tooltip">
                                            <div>{tt('steem_tools.claim_act.payment')}</div>
                                        </div>
                                    </div>

                                    <div className="column flex-container-2 flex-mobile-full">
                                        <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                            <select
                                                className="input-group-field"
                                                value={payment}
                                                onChange={this.onChangePayment}
                                            >
                                                <option value="RC">
                                                    {tt('steem_tools.claim_act.pay_with_rc')}
                                                </option>
                                                <option value="STEEM">
                                                    {tt('steem_tools.claim_act.pay_with_steem')}
                                                </option>
                                            </select>
                                        </div>
                                    </div>
                                </div>

                                <div className="row row-column-mobile">
                                    <div className="column flex-container-1 flex-mobile-full" style={{ paddingTop: 5 }}>
                                        <div>{tt('steem_tools.claim_act.amount')}</div>
                                    </div>

                                    <div className="column flex-container-2 flex-mobile-full">
                                        <div className="input-group" style={{ marginBottom: '1.25rem' }}>
                                            <input
                                                type="number"
                                                className="input-group-field"
                                                min="1"
                                                max={Math.max(maxAllowed, 1)}
                                                value={claimAmount}
                                                onChange={this.onChangeClaimAmount}
                                            />
                                            <span className="input-group-label">
                                                {tt('steem_tools.claim_act.act_suffix')}
                                            </span>
                                        </div>

                                        <div style={{ marginTop: -10, fontSize: 12, opacity: 0.8 }}>
                                            {payment === 'RC'
                                                ? `${numberWithCommas(String(rcPerAct))} RC per ACT`
                                                : `${String(steemPerAct)} per ACT`}
                                        </div>
                                    </div>
                                </div>

                                {error ? (
                                    <div className="row">
                                        <div className="column">
                                            <div className="advtools-message-error">{error}</div>
                                        </div>
                                    </div>
                                ) : null}

                                <div className="row">
                                    <div className="column">
                                        <button
                                            type="button"
                                            className="button advtools-btn-primary"
                                            onClick={this.onClaim}
                                            disabled={!canClaim}
                                        >
                                            {tt('steem_tools.claim_act.claim_btn')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }
}

export default connect(
    function mapState(state, ownProps) {
        let current =
            state && state.user && state.user.get ? state.user.get('current') : null;

        let username =
            current && current.get && current.get('username') ? current.get('username') : '';

        let account = ownProps.accountname
            ? state.global.getIn(['accounts', ownProps.accountname])
            : null;

        let steem_balance =
            account && account.get && account.get('balance') ? account.get('balance') : '0.000 STEEM';

        let pending_claimed_accounts =
            account && account.get && account.get('pending_claimed_accounts')
                ? account.get('pending_claimed_accounts')
                : 0;

        let balance = String(steem_balance).split(' ')[0] || '0.000';

        let totalVestingShares =
            state.global.getIn(['props', 'total_vesting_shares'])
                ? String(state.global.getIn(['props', 'total_vesting_shares'])).split(' ')[0]
                : '0.00';

        let DEFAULT_ACCOUNT_CREATION_FEE = '3.000 STEEM';

        let witness_schedule = state.global.get ? state.global.get('witness_schedule') : null;
        let median_props =
            witness_schedule && witness_schedule.get ? witness_schedule.get('median_props') : null;
        let account_creation_fee =
            median_props && median_props.get ? median_props.get('account_creation_fee') : null;

        let steemPerActRaw =
            account_creation_fee && String(account_creation_fee).includes(' ')
                ? String(account_creation_fee)
                : DEFAULT_ACCOUNT_CREATION_FEE;

        let steemPerActNum = steemPerActRaw
            ? parseFloat(String(steemPerActRaw).split(' ')[0]) || 3
            : 3;

        let accounts = state.global.get ? state.global.get('accounts') : null;
        let isLoggedIn = !!username;

        return {
            ...ownProps,
            username: username || '',
            isLoggedIn,
            balance,
            accounts,
            pending_claimed_accounts,
            totalVestingShares,
            steemPerActNum,
            steemPerActRaw,
        };
    },
    function mapDispatch(dispatch) {
        return {
            claimAct: ({
                creator,
                fee,
                payment,
                claimAmount,
                claimable,
                rcPerAct,
                steemPerAct,
                optimisticUpdate,
                successCallback,
                errorCallback,
            }) => {
                let confirm = () => (
                    <ConfirmClaimAct
                        operation={{
                            account: creator,
                            payment,
                            fee,
                            claimAmount,
                            claimable,
                            rcPerAct,
                            steemPerAct,
                        }}
                    />
                );

                let refreshAndNotify = () => {
                    dispatch(userActions.refreshAccount({ owner: creator }));
                    dispatch(
                        appActions.addNotification({
                            key: 'claim_act_' + Date.now(),
                            message: tt('steem_tools.claim_act.claim_notification', {
                                count: claimAmount,
                            }),
                            dismissAfter: 5000,
                        })
                    );
                };

                let operations = [];
                for (let i = 0; i < claimAmount; i++) {
                    operations.push([
                        'claim_account',
                        {
                            creator: creator,
                            fee: fee,
                            extensions: [],
                        },
                    ]);
                }

                dispatch(
                    transactionActions.broadcastOperations({
                        operations,
                        confirm,
                        confirmTitle: tt('steem_tools.claim_act.confirm_title'),
                        successCallback: () => {
                            refreshAndNotify();
                            if (optimisticUpdate) optimisticUpdate();
                            if (successCallback) successCallback();
                        },
                        errorCallback: (err) => {
                            if (errorCallback) errorCallback(err);
                        },
                    })
                );
            },
        };
    }
)(ClaimDiscounted);
