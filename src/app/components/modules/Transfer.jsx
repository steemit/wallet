/* eslint-disable react/forbid-prop-types */
/* eslint-disable react/no-string-refs */
/* eslint-disable jsx-a11y/no-static-element-interactions */
/* eslint-disable react/no-find-dom-node */
/* eslint-disable no-undef */
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import ReactDOM from 'react-dom';
import reactForm from 'app/utils/ReactForm';
import { Map, List, OrderedSet } from 'immutable';
import Autocomplete from 'react-autocomplete';
import tt from 'counterpart';
import VerifiedExchangeList from 'app/utils/VerifiedExchangeList';
import Fuse from 'fuse.js/dist/fuse';

import * as transactionActions from 'app/redux/TransactionReducer';
import * as userActions from 'app/redux/UserReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import * as appActions from 'app/redux/AppReducer';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import ConfirmTransfer from 'app/components/elements/ConfirmTransfer';
import ConfirmDelegationTransfer from 'app/components/elements/ConfirmDelegationTransfer';
import { FormattedHTMLMessage } from 'app/Translator';
import runTests, { browserTests } from 'app/utils/BrowserTests';
import { recordAdsView, userActionRecord } from 'app/utils/ServerApiClient';
import {
    validate_exchange_account_with_memo,
    validate_account_name_with_memo,
    validate_memo_field,
    validate_account_name,
} from 'app/utils/ChainValidation';
import { countDecimals } from 'app/utils/ParsersAndFormatters';
import { APP_NAME, LIQUID_TOKEN, VESTING_TOKEN } from 'app/client_config';
import { connect } from 'react-redux';

/** Warning .. This is used for Power UP too. */
class TransferForm extends Component {
    static propTypes = {
        // redux
        currentUser: PropTypes.object.isRequired,
        toVesting: PropTypes.bool.isRequired,
        toDelegate: PropTypes.bool.isRequired,
        currentAccount: PropTypes.object.isRequired,
        following: PropTypes.object.isRequired,
        totalVestingFund: PropTypes.number.isRequired,
        totalVestingShares: PropTypes.number.isRequired,
        errorMessage: undefined,
    };

    static defaultProps = {
        following: OrderedSet([]),
    };

    constructor(props) {
        super(props);
        const { transferToSelf, initialValues } = props;
        this.state = {
            advanced: !transferToSelf,
            transferTo: false,
            autocompleteUsers: [],
            show_transfer_button: false,
            isVerifiedAccount: false,
            isSuspiciousAccount: false,
            toggleExchangeRender: false,
            exchangeValidation: false,
        };
        this.fuse = new Fuse(VerifiedExchangeList, {
            includeScore: true,
            threshold: 0.4,
        });
        this.initForm(props);
    }

    componentDidMount() {
        setTimeout(() => {
            const { advanced } = this.state;
            if (advanced) this.to.focus();
            else ReactDOM.findDOMNode(this.refs.amount).focus();
        }, 300);

        runTests();

        this.buildTransferAutocomplete();
    }

    componentDidUpdate(prevProps, prevState) {
        const { isVerifiedAccount, isSuspiciousAccount } = this.state;
        const { transferType } = this.props.initialValues;
        const shouldRenderToggle =
            ((isVerifiedAccount && transferType === "Transfer to Account") ||
            (!isVerifiedAccount && isSuspiciousAccount && transferType === "Transfer to Account"));
        const prevTransferType = prevProps.initialValues.transferType;
        const hasChanged =
            prevState.isVerifiedAccount !== isVerifiedAccount ||
            prevState.isSuspiciousAccount !== isSuspiciousAccount ||
            prevTransferType !== transferType;
        if (hasChanged && this.state.toggleExchangeRender !== shouldRenderToggle) {
            this.updateToggleExchangeRender(shouldRenderToggle)
        }
    }

    updateToggleExchangeRender(toggleExchangeRender) {
        this.setState({ toggleExchangeRender });
    }

    buildTransferAutocomplete() {
        // Get names for the recent account transfers
        const labelPreviousTransfers = tt(
            'transfer_jsx.autocomplete_previous_transfers'
        );
        const labelFollowingUser = tt(
            'transfer_jsx.autocomplete_user_following'
        );

        const transferToLog = this.props.currentAccount
            .get('transfer_history', List())
            .reduce((acc, cur) => {
                if (cur.getIn([1, 'op', 0]) === 'transfer') {
                    const username = cur.getIn([1, 'op', 1, 'to']);
                    const numTransfers = acc.get(username)
                        ? acc.get(username).numTransfers + 1
                        : 1;
                    return acc.set(username, {
                        username,
                        label: `${numTransfers} ${labelPreviousTransfers}`,
                        numTransfers,
                    });
                }
                return acc;
            }, Map())
            .remove(this.props.currentUser.get('username'));

        // Build a combined list of users you follow & have previously transferred to,
        // and sort it by 1. desc the number of previous transfers 2. username asc.
        this.setState({
            autocompleteUsers: this.props.following
                .toOrderedMap()
                .map(username => ({
                    username,
                    label: labelFollowingUser,
                    numTransfers: 0,
                }))
                .merge(transferToLog)
                .sortBy(null, (a, b) => {
                    //prioritize sorting by number of transfers
                    if (a.numTransfers > b.numTransfers) {
                        return -1;
                    }
                    if (b.numTransfers > a.numTransfers) {
                        return 1;
                    }
                    //if transfer number is the same, sort by username
                    if (a.username > b.username) {
                        return 1;
                    }
                    if (b.username > a.username) {
                        return -1;
                    }
                    return 0;
                })
                .toArray(),
        });
    }

    matchAutocompleteUser = (item, value) => {
        return item.username.toLowerCase().indexOf(value.toLowerCase()) > -1;
    };

    onAdvanced = e => {
        e.preventDefault(); // prevent form submission!!
        const username = this.props.currentUser.get('username');
        this.state.to.props.onChange(username);
        // setTimeout(() => {ReactDOM.findDOMNode(this.refs.amount).focus()}, 300)
        this.setState({ advanced: !this.state.advanced });
    };

    getCharMatchInfo = (input, target) => {
        const result = {
            percentage: 0,
            exactMatch: false,
            isSubstring: false,
            containsOriginal: false,
            noMatch: true,
        };
        if (!input || !target) return result;
        input = input.toLowerCase();
        target = target.toLowerCase();
        if (input === target) {
            result.percentage = 100;
            result.exactMatch = true;
            result.noMatch = false;
        }
        else if (target.includes(input)) {
            result.percentage = Math.round((input.length / target.length) * 100);
            result.isSubstring = true;
            result.noMatch = false;
        }
        else if (input.includes(target)) {
            result.percentage = Math.round((target.length / input.length) * 100);
            result.containsOriginal = true;
            result.noMatch = false;
        }
        return result;
    }

    checkExchangeStatus = (accountName) => {
        const lowerName = accountName.trim().toLowerCase();
        const isVerified = VerifiedExchangeList.includes(lowerName);
        let similarityPercentage = 0;
        let similarAccountName = null;
        let isSuspicious = false;
        const fuzzyResults = this.fuse.search(lowerName);
        const { transferType } = this.props.initialValues;
        const exchangeValidation = validate_exchange_account_with_memo(accountName, transferType)
        if ((!isVerified && fuzzyResults.length > 0) || exchangeValidation) {
            const topResult = fuzzyResults[0];
            similarAccountName = topResult.item;
            const score = Math.round((1 - topResult.score) * 100);
            const matchInfo = this.getCharMatchInfo(accountName, similarAccountName);
            const charMatch = matchInfo.percentage;
            const finalScore = Math.round((charMatch + score) / 2);
            similarityPercentage = finalScore
            if (finalScore >= 70) {
                isSuspicious = true;
            }
        }
        this.setState({
            isVerifiedAccount: isVerified,
            isSuspiciousAccount: isSuspicious,
            similarityPercentage,
            similarAccountName,
            exchangeValidation,
        });
    };

    initForm(props) {
        const { transferType } = props.initialValues;
        const insufficientFunds = (asset, amount) => {
            const { currentAccount } = props;
            const isWithdraw =
                transferType && transferType === 'Savings Withdraw';
            const balanceValue =
                !asset || asset === 'STEEM'
                    ? isWithdraw
                        ? currentAccount.get('savings_balance')
                        : currentAccount.get('balance')
                    : asset === 'SBD'
                        ? isWithdraw
                            ? currentAccount.get('savings_sbd_balance')
                            : currentAccount.get('sbd_balance')
                        : null;
            if (!balanceValue) return false;
            const balance = balanceValue.split(' ')[0];
            return parseFloat(amount) > parseFloat(balance);
            // return parseFloat(balance) == 0.00 ? true: parseFloat(amount) > parseFloat(balance);
        };
        const { toVesting, toDelegate } = props;
        const fields = toVesting ? ['to', 'amount'] : ['to', 'amount', 'asset'];
        if (
            !toVesting &&
            !toDelegate &&
            transferType !== 'Transfer to Savings' &&
            transferType !== 'Savings Withdraw'
        ) {
            fields.push('memo');
        }
        reactForm({
            name: 'transfer',
            instance: this,
            fields,
            initialValues: props.initialValues,
            validation: values => ({
                to: !values.to
                    ? tt('g.required')
                    : validate_account_name_with_memo(values.to, values.memo, transferType, true),
                amount: !values.amount
                    ? tt('g.required')
                    : !/^\d+(\.\d+)?$/.test(values.amount)
                        ? tt('transfer_jsx.amount_is_in_form')
                        : insufficientFunds(values.asset, values.amount)
                            ? tt('transfer_jsx.insufficient_funds')
                            : countDecimals(values.amount) > 3
                                ? tt(
                                      'transfer_jsx.use_only_3_digits_of_precison'
                                  )
                                : toDelegate &&
                                  (values.amount < 1 && values.amount > 0)
                                    ? tt(
                                          'transfer_jsx.minimum_required_delegation_amount'
                                      )
                                    : null,
                asset: props.toVesting
                    ? null
                    : !values.asset
                        ? tt('g.required')
                        : null,
                memo: values.memo
                    ? validate_memo_field(
                          values.memo,
                          props.currentUser.get('username'),
                          props.currentAccount.get('memo_key')
                      )
                    : values.memo &&
                      (!browserTests.memo_encryption && /^#/.test(values.memo))
                        ? 'Encrypted memos are temporarily unavailable (issue #98)'
                        : null,
            }),
        });
    }

    clearError = () => {
        this.setState({ trxError: undefined, tronLoading: false });
    };

    errorCallback = estr => {
        this.setState({
            trxError: estr, loading: false, tronLoading: false,
            errorMessage: String(estr),
        });
    };

    balanceValue() {
        const { transferType } = this.props.initialValues;
        const {
            currentAccount,
            toDelegate,
            totalVestingShares,
            totalVestingFund,
        } = this.props;
        const { asset } = this.state;
        const isWithdraw = transferType && transferType === 'Savings Withdraw';
        let balanceValue =
            !asset || asset.value === 'STEEM'
                ? isWithdraw
                    ? currentAccount.get('savings_balance')
                    : currentAccount.get('balance')
                : asset.value === 'SBD'
                    ? isWithdraw
                        ? currentAccount.get('savings_sbd_balance')
                        : currentAccount.get('sbd_balance')
                    : asset.value === 'TRX'
                        ? Math.floor(this.props.tronBalance * 1000) / 1000 +
                          ' TRX'
                        : null;
        if (toDelegate) {
            balanceValue = currentAccount.get('savings_balance');
            const vestingShares = parseFloat(
                currentAccount.get('vesting_shares')
            );
            const toWithdraw = parseFloat(currentAccount.get('to_withdraw'));
            const withdrawn = parseFloat(currentAccount.get('withdrawn'));
            const delegatedVestingShares = parseFloat(
                currentAccount.get('delegated_vesting_shares')
            );
            // Available Vests Calculation.
            const avail =
                vestingShares -
                (toWithdraw - withdrawn) / 1e6 -
                delegatedVestingShares;
            // Representation of available Vests as STEEM.
            const vestSteem = totalVestingFund * (avail / totalVestingShares);
            balanceValue = `${vestSteem.toFixed(3)} Steem Power`;
        }
        return balanceValue;
    }

    assetBalanceClick = e => {
        e.preventDefault();
        // Convert '9.999 STEEM' to 9.999
        this.state.amount.props.onChange(this.balanceValue().split(' ')[0]);
    };

    onChangeTo = async value => {
        const cleanValue = value.replace(/\s+/g, '');
        this.state.to.props.onChange(cleanValue);
        const { transferType } = this.props.initialValues;
        if (transferType === 'Transfer to Account') {
            this.checkExchangeStatus(cleanValue);
            this.setState({ toggle_check: false });
        }
    };

    onChangeValueForm = (value, onChange) => {
        onChange(value);
        const { transferType } = this.props.initialValues;
        if (transferType === 'Transfer to Account') {
            this.setState({ toggle_check: false });
        }
    };

    clearToTronInfo = () => {
        this.props.checkTron(null, null, null);
    };

    handleToggleChange = (event) => {
        this.setState({ toggle_check: event.target.checked });
    }

    render() {
        const transferTips = {
            'Transfer to Account': tt(
                'transfer_jsx.move_funds_to_another_account',
                { APP_NAME }
            ),
            'Transfer to Savings': tt(
                'transfer_jsx.protect_funds_by_requiring_a_3_day_withdraw_waiting_period'
            ),
            'Savings Withdraw': tt(
                'transfer_jsx.withdraw_funds_after_the_required_3_day_waiting_period'
            ),
            // 'Delegate to Account': tt(
            //     'transfer_jsx.'
            // ),
        };
        const powerTip3 = tt(
            'tips_js.converted_VESTING_TOKEN_can_be_sent_to_yourself_but_can_not_transfer_again',
            { LIQUID_TOKEN, VESTING_TOKEN }
        );
        const { to, amount, asset, memo } = this.state;
        const { loading, advanced, toggle_check, errorMessage } = this.state;
        const {
            currentUser,
            toVesting,
            toDelegate,
            transferToSelf,
            dispatchSubmit,
            totalVestingFund,
            totalVestingShares,
            tronAccountCheckError,
            trackingId,
            transferAsyncValidationLock,
        } = this.props;
        const { transferType } = this.props.initialValues;
        const { submitting, valid, handleSubmit } = this.state.transfer;
        // const isMemoPrivate = memo && /^#/.test(memo.value); -- private memos are not supported yet
        const isMemoPrivate = false;

        const form = (
            <form
                onSubmit={handleSubmit(({ data }) => {
                    // steem transfer
                    this.setState({ loading: true, errorMessage: undefined });
                    dispatchSubmit({
                        ...data,
                        errorCallback: this.errorCallback,
                        currentUser,
                        toVesting,
                        toDelegate,
                        transferType,
                        totalVestingShares,
                        totalVestingFund,
                    });
                })}
                onChange={this.clearError}
            >
                {toVesting && (
                    <div className="row">
                        <div className="column small-12">
                            <p>{tt('tips_js.influence_token')}</p>
                            <p>
                                {tt('tips_js.non_transferable', {
                                    LIQUID_TOKEN,
                                    VESTING_TOKEN,
                                })}
                            </p>
                        </div>
                    </div>
                )}

                {!toVesting && (
                    <div>
                        <div className="row">
                            <div className="column small-12">
                                {toDelegate ? (
                                    <FormattedHTMLMessage
                                        className="secondary"
                                        id="transfer_jsx.delegate_vesting"
                                    />
                                ) : (
                                    transferTips[transferType]
                                )}
                            </div>
                        </div>
                        <br />
                    </div>
                )}

                <div className="row">
                    <div className="column small-2" style={{ paddingTop: 5 }}>
                        {tt('transfer_jsx.from')}
                    </div>
                    <div className="column small-10">
                        <div
                            className="input-group"
                            style={{ marginBottom: '1.25rem' }}
                        >
                            <span className="input-group-label">@</span>
                            <input
                                className="input-group-field bold"
                                type="text"
                                disabled
                                value={currentUser.get('username')}
                            />
                        </div>
                    </div>
                </div>

                {advanced && (
                    <div className="row">
                        <div
                            className="column small-2"
                            style={{ paddingTop: 5 }}
                        >
                            {tt('transfer_jsx.to')}
                        </div>
                        <div className="column small-10">
                            <div
                                className="input-group"
                                style={{ marginBottom: '1.25rem' }}
                            >
                                <Autocomplete
                                    wrapperStyle={{
                                        display: 'inline-block',
                                        width: '100%',
                                    }}
                                    inputProps={{
                                        type: 'text',
                                        className: 'input-group-field',
                                        autoComplete: 'off',
                                        autoCorrect: 'off',
                                        autoCapitalize: 'off',
                                        spellCheck: 'false',
                                        disabled: loading,
                                    }}
                                    renderMenu={items => (
                                        <div
                                            className={`react-autocomplete-input ${items.length ===
                                                0 &&
                                                'react-autocomplete-input-no-data'}`}
                                        >
                                            {items}
                                        </div>
                                    )}
                                    ref={el => (this.to = el)}
                                    getItemValue={item => item.username}
                                    items={this.state.autocompleteUsers}
                                    shouldItemRender={
                                        this.matchAutocompleteUser
                                    }
                                    renderItem={(item, isHighlighted) => (
                                        <div
                                            key={item.username}
                                            className={
                                                isHighlighted ? 'active' : ''
                                            }
                                        >
                                            {`${item.username} (${item.label})`}
                                        </div>
                                    )}
                                    value={this.state.to.value || ''}
                                    onChange={async e => {
                                        await this.onChangeTo(e.target.value);
                                    }}
                                    onSelect={async val => {
                                        await this.onChangeTo(val);
                                    }}
                                />
                            </div>
                            {to.touched && <p>{toVesting && powerTip3}</p>}
                        </div>
                        {(to && to.touched && to.error) ? (
                            <div className="column small-12 callout alert">
                                {to &&
                                    to.touched &&
                                    to.error &&
                                    to.error}&nbsp;
                            </div>
                        ) : null}
                    </div>
                )}

                <div className="row">
                    <div className="column small-2" style={{ paddingTop: 5 }}>
                        {tt('g.amount')}
                    </div>
                    <div className="column small-10">
                        <div
                            className="input-group"
                            style={{ marginBottom: 5 }}
                        >
                            <input
                                type="text"
                                placeholder={tt(
                                    toDelegate
                                        ? 'g.delegation_placeholder'
                                        : 'g.amount'
                                )}
                                {...amount.props}
                                onChange={(event) => { this.onChangeValueForm(event.target.value, amount.props.onChange) }}
                                ref="amount"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck="false"
                                disabled={loading}
                            />
                            {asset &&
                                asset.value !== 'VESTS' && (
                                    <span
                                        className="input-group-label"
                                        style={{
                                            paddingLeft: 0,
                                            paddingRight: 0,
                                        }}
                                    >
                                        <select
                                            {...asset.props}
                                            onChange={(event) => { this.onChangeValueForm(event.target.value, asset.props.onChange) }}
                                            placeholder={tt(
                                                'transfer_jsx.asset'
                                            )}
                                            disabled={loading}
                                            style={{
                                                minWidth: '5rem',
                                                height: 'inherit',
                                                backgroundColor: 'transparent',
                                                border: 'none',
                                            }}
                                        >
                                            <option value="STEEM">STEEM</option>
                                            <option value="SBD">SBD</option>
                                        </select>
                                    </span>
                                )}
                            {asset &&
                                asset.value === 'VESTS' && (
                                    <span
                                        className="input-group-label"
                                        style={{
                                            paddingLeft: 0,
                                            paddingRight: 0,
                                        }}
                                    >
                                        <select
                                            {...asset.props}
                                            placeholder={tt(
                                                'transfer_jsx.asset'
                                            )}
                                            disabled={loading || toDelegate}
                                            style={{
                                                minWidth: '5rem',
                                                height: 'inherit',
                                                backgroundColor: 'transparent',
                                                border: 'none',
                                            }}
                                        >
                                            <option value="STEEM">
                                                Steem Power
                                            </option>
                                        </select>
                                    </span>
                                )}
                        </div>
                        <div style={{ marginBottom: '0.6rem' }}>
                            <AssetBalance
                                balanceValue={this.balanceValue()}
                                onClick={this.assetBalanceClick}
                            />
                        </div>
                        {(asset && asset.touched && asset.error) ||
                        (amount.touched && amount.error) ? (
                            <div className="error">
                                {asset &&
                                    asset.touched &&
                                    asset.error &&
                                    asset.error}&nbsp;
                                {amount.touched &&
                                    amount.error &&
                                    amount.error}&nbsp;
                            </div>
                        ) : null}
                    </div>
                </div>

                {memo && (
                    <div className="row">
                        <div
                            className="column small-2"
                            style={{ paddingTop: 33 }}
                        >
                            {tt('g.memo')}
                        </div>
                        <div className="column small-10">
                            <small>
                                {isMemoPrivate
                                    ? tt('transfer_jsx.this_memo_is_private')
                                    : tt('transfer_jsx.this_memo_is_public')}
                            </small>
                            <input
                                type="text"
                                placeholder={tt('g.memo')}
                                {...memo.props}
                                onChange={(event) => { this.onChangeValueForm(event.target.value, memo.props.onChange) }}
                                ref="memo"
                                autoComplete="on"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck="false"
                                disabled={loading}
                            />
                            <div className="error">
                                {memo.touched && memo.error && memo.error}&nbsp;
                            </div>
                        </div>
                    </div>
                )}
                {this.state.isVerifiedAccount && transferType === "Transfer to Account" && (
                    <div className="row">
                        <div
                            className="column callout alert"
                            style={{ margin: '0 15px 30px' }}
                        >
                            <FormattedHTMLMessage
                                id="transfer_jsx.exchange_alert"
                                params={{ asset: asset.value }}
                            />
                        </div>
                    </div>
                )}

                {!this.state.isVerifiedAccount && this.state.isSuspiciousAccount && transferType === "Transfer to Account" && (
                    <div className="row">
                        <div
                            className="column callout warning"
                            style={{ margin: '0 15px 30px' }}
                        >
                            <FormattedHTMLMessage
                                id="transfer_jsx.similar_account_warning"
                                params={{
                                    accountName: this.state.similarAccountName,
                                    similarity: this.state.similarityPercentage
                                }}
                            />
                        </div>
                    </div>
                )}

                {(!this.state.toggleExchangeRender && this.state.exchangeValidation) && transferType === "Transfer to Account" && (
                    <div className="row">
                        <div
                            className="column callout alert"
                            style={{ margin: '0 15px 30px' }}
                        >
                            {tt("transfer_jsx.exchange_misspelling")}
                        </div>
                    </div>
                )}

                {(this.state.toggleExchangeRender || this.state.exchangeValidation) && (
                    <div className="row">
                        <div className="column toggle_container">
                            <span>
                                {tt("transfer_jsx.toggle_exchange_message")}
                            </span>
                            <label className="switch">
                                <input
                                    name="toggle_check"
                                    type="checkbox"
                                    checked={toggle_check}
                                    ref="toggle_check"
                                    onChange={this.handleToggleChange}
                                />
                                <span className="slider round" />
                            </label>
                        </div>
                    </div>
                )}

                {errorMessage && (
                    <div className="row">
                        <div className="column small-12 callout alert">
                            {errorMessage}
                        </div>
                    </div>
                )}

                <div className="row">
                    <div className="column">
                        {loading && (
                            <span>
                                <LoadingIndicator type="circle" />
                                <br />
                            </span>
                        )}
                        {!loading && (
                            <span>
                                <button
                                    type="submit"
                                    disabled={
                                        submitting ||
                                        !valid ||
                                        ((this.state.toggleExchangeRender || this.state.exchangeValidation) && !toggle_check) ||
                                        transferAsyncValidationLock > 0
                                    }
                                    className="button"
                                >
                                    {toVesting
                                        ? tt('g.power_up')
                                        : tt('g.next')}
                                </button>

                                {transferToSelf && (
                                    <button
                                        className="button hollow no-border"
                                        disabled={submitting}
                                        onClick={this.onAdvanced}
                                    >
                                        {advanced
                                            ? tt('g.basic')
                                            : tt('g.advanced')}
                                    </button>
                                )}
                            </span>
                        )}
                    </div>
                </div>
            </form>
        );

        return (
            <div>
                <div className="row">
                    <h3 className="column">
                        {toVesting
                            ? tt('transfer_jsx.convert_to_VESTING_TOKEN', {
                                  VESTING_TOKEN,
                              })
                            : transferType}
                    </h3>
                </div>
                {form}
            </div>
        );
    }
}

const AssetBalance = ({ onClick, balanceValue }) => (
    <a
        onClick={onClick}
        style={{ borderBottom: '#A09F9F 1px dotted', cursor: 'pointer' }}
    >
        {tt('g.balance', { balanceValue })}
    </a>
);

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const totalVestingShares = state.global.getIn([
            'props',
            'total_vesting_shares',
        ])
            ? parseFloat(
                  state.global
                      .getIn(['props', 'total_vesting_shares'])
                      .split(' ')[0]
              )
            : 0;

        const totalVestingFund = state.global.getIn([
            'props',
            'total_vesting_fund_steem',
        ])
            ? parseFloat(
                  state.global
                      .getIn(['props', 'total_vesting_fund_steem'])
                      .split(' ')[0]
              )
            : 0;
        const initialValues = state.user.get('transfer_defaults', Map()).toJS();
        const toVesting = initialValues.asset === 'VESTS';
        const toDelegate = initialValues.asset === 'DELEGATE_VESTS';
        if (toDelegate) {
            initialValues.asset = 'VESTS';
        }
        const currentUser = state.user.getIn(['current']);
        const currentAccount = state.global.getIn([
            'accounts',
            currentUser.get('username'),
        ]);

        if (!toVesting && !initialValues.transferType)
            initialValues.transferType = 'Transfer to Account';

        let transferToSelf =
            toVesting ||
            /Transfer to Savings|Savings Withdraw/.test(
                initialValues.transferType
            );
        if (transferToSelf && !initialValues.to)
            initialValues.to = currentUser.get('username');

        if (initialValues.to !== currentUser.get('username'))
            transferToSelf = false; // don't hide the to field
        return {
            ...ownProps,
            trackingId: state.app.getIn(['trackingId'], null),
            currentUser,
            currentAccount,
            toVesting,
            toDelegate,
            transferToSelf,
            initialValues,
            following: state.global.getIn([
                'follow',
                'getFollowingAsync',
                currentUser.get('username'),
                'blog_result',
            ]),
            totalVestingFund,
            totalVestingShares,
            transferAsyncValidationLock: state.app.has(
                'transferAsyncValidationLock'
            )
                ? state.app.get('transferAsyncValidationLock')
                : 0,
        };
    },

    // mapDispatchToProps
    dispatch => ({
        dispatchSubmit: ({
            to,
            amount,
            asset,
            memo,
            transferType,
            toVesting,
            toDelegate,
            currentUser,
            errorCallback,
            totalVestingFund,
            totalVestingShares,
        }) => {
            if (
                !toVesting &&
                !/Transfer to Account|Transfer to Savings|Delegate to Account|Savings Withdraw/.test(
                    transferType
                )
            )
                throw new Error(
                    `Invalid transfer params: toVesting ${toVesting}, transferType ${transferType}`
                );

            const username = currentUser.get('username');
            const transactionType = toVesting
                ? 'transfer_to_vesting'
                : transferType === 'Transfer to Account'
                    ? 'transfer'
                    : transferType === 'Transfer to Savings'
                        ? 'transfer_to_savings'
                        : transferType === 'Savings Withdraw'
                            ? 'transfer_from_savings'
                            : transferType === 'Delegate to Account'
                                ? 'delegate_vesting_shares'
                                : null;
            const asset2 = toVesting ? 'STEEM' : toDelegate ? 'VESTS' : asset;
            const successCallback = () => {
                if (transactionType !== null) {
                    userActionRecord(transactionType, {
                        transferCoin: asset2,
                        amount,
                        from: username,
                        to,
                    });
                }
                // refresh transfer history
                dispatch(
                    globalActions.getState({ url: `@${username}/transfers` })
                );
                if (/Savings Withdraw/.test(transferType)) {
                    dispatch(userActions.loadSavingsWithdraw({}));
                }
                dispatch(userActions.hideTransfer());
            };
            let operation = {
                from: username,
                to,
                amount: parseFloat(amount, 10).toFixed(3) + ' ' + asset2,
                memo: toVesting ? undefined : memo ? memo : '',
            };
            let confirm = () => <ConfirmTransfer operation={operation} />;
            if (transferType === 'Savings Withdraw')
                operation.request_id = Math.floor(
                    (Date.now() / 1000) % 4294967295
                );
            if (toDelegate) {
                // Convert amount in steem to vests...
                const amountSteemAsVests =
                    (amount * totalVestingShares) / totalVestingFund;
                operation = {
                    delegator: username,
                    delegatee: to,
                    vesting_shares:
                        parseFloat(amountSteemAsVests, 10).toFixed(6) +
                        ' ' +
                        asset2,
                };
                confirm = () => (
                    <ConfirmDelegationTransfer
                        operation={operation}
                        amount={amount}
                    />
                );
            }
            dispatch(
                transactionActions.broadcastOperation({
                    type: transactionType,
                    operation,
                    successCallback,
                    errorCallback,
                    confirm,
                })
            );
        },
        lockTransferAsyncValidation: () =>
            dispatch(appActions.lockTransferAsyncValidation()),
        unlockTransferAsyncValidation: () =>
            dispatch(appActions.unlockTransferAsyncValidation()),
    })
)(TransferForm);
