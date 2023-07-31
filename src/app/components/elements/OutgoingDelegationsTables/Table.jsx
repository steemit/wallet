import React from 'react';
import { Link } from 'react-router';
import tt from 'counterpart';
import TimeAgoWrapper from 'app/components/elements/TimeAgoWrapper';
import Icon from 'app/components/elements/Icon';
import { numberWithCommas } from 'app/utils/StateFunctions';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import { ASC, DELEGATEE, DATE, AMOUNT } from './constants'

class Table extends React.Component {
    constructor() {
        super();
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'Table');
    }
    render() {
        const {
            sortData,
            vestingDelegations,
            sortBy,
            sort,
            isMyAccount,
            convertVestsToSteem,
            updateClipboard,
            showTransferHandler,
            total
        } = this.props

        return (
            <table>
                <thead>
                    <tr>
                        <th
                            onClick={() => { sortData(DELEGATEE) }}
                        >
                            {`${tt('outgoingdelegations_jsx.delegatee')} (${total})`}
                            <span className={sortBy === DELEGATEE ? "icon--active" : ""}>
                                {sort !== ASC
                                    ? (<Icon name="dropdown-arrow" />)
                                    : (<Icon name="dropdown-arrow" className="up-arrow" style={{ transform: 'rotate(180deg)' }} />)
                                }
                            </span>
                        </th>
                        <th
                            onClick={() => { sortData(DATE) }}
                        >
                            {tt('outgoingdelegations_jsx.start_date')}
                            <span className={sortBy === DATE ? "icon--active" : ""}>
                                {sort !== ASC
                                    ? (<Icon name="dropdown-arrow" />)
                                    : (<Icon name="dropdown-arrow" className="up-arrow" style={{ transform: 'rotate(180deg)' }} />)
                                }
                            </span>
                        </th>
                        <th
                            onClick={() => { sortData(AMOUNT) }}
                            className="column-number"
                        >
                            {tt('outgoingdelegations_jsx.amount_delegated')}
                            <span className={sortBy === AMOUNT ? "icon--active" : ""}>
                                {sort !== ASC
                                    ? (<Icon name="dropdown-arrow" />)
                                    : (<Icon name="dropdown-arrow" className="up-arrow" style={{ transform: 'rotate(180deg)' }} />)
                                }
                            </span>
                        </th>
                        {isMyAccount && (
                            <th>{tt('outgoingdelegations_jsx.revoke_title')}</th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {vestingDelegations.map((item) => {
                        const vestsAsSteem = convertVestsToSteem(
                            parseFloat(item.vesting_shares)
                        );
                        return (<tr
                            key={`${item.delegator}--${item.delegatee}--${item.min_delegation_time}`}
                        >
                            <td>
                                <Link to={`/@${item.delegatee}`}>
                                    {item.delegatee}
                                </Link>
                            </td>
                            <td
                                className="text--capitalize"
                            >
                                <span
                                    style={{cursor: "pointer"}}
                                    onClick={() => { updateClipboard(item.min_delegation_time) }}
                                >
                                    <TimeAgoWrapper date={item.min_delegation_time} />
                                </span>
                            </td>
                            <td
                                className="column-number"
                                title={`${parseFloat(item.vesting_shares)} VESTS`}
                            >
                                <span
                                    style={{cursor: "pointer"}}
                                    onClick={() => { updateClipboard(`${numberWithCommas(vestsAsSteem)} SP`) }}
                                >
                                    {`${numberWithCommas(vestsAsSteem)} SP`}
                                </span>
                            </td>
                            {isMyAccount && (
                                <td>
                                    <button
                                        className="delegations__revoke button hollow"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            showTransferHandler(item.delegatee);
                                        }}
                                        type="button"
                                    >
                                        {' '}
                                        {tt('outgoingdelegations_jsx.revoke')}{' '}
                                    </button>
                                </td>
                            )}
                        </tr>)
                    })
                    }
                </tbody>
            </table>
        )
    }
}
export default Table;
